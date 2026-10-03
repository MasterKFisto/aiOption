# Deploying aioption to Alibaba Cloud ECS (Phase 7)

Single-container deployment of the personal AI options app: Fastify API +
built web UI on port **8080**, bound to **127.0.0.1 only**. You reach it
through an SSH tunnel — the app is never exposed to the public internet.

```
your laptop ── ssh -L 8080:localhost:8080 ──► ECS ──► http://localhost:8080
```

## 1. Create the ECS instance

- Image: **Ubuntu 24.04** (or Alibaba Cloud Linux 3), 1 vCPU / 1–2 GiB is enough.
- Security group: allow inbound **22/tcp** from your IP only. Do **not** open
  8080 — the app binds to loopback.
- Create a non-root sudo user (or use `root` for setup, then harden SSH).

## 2. One-time server setup

```bash
scp -i key.pem -r deploy user@ECS_IP:~/
ssh -i key.pem user@ECS_IP 'sudo bash ~/deploy/ecs/setup.sh'
```

`setup.sh` installs Docker Engine + the compose plugin, creates
`/opt/aioption`, and enables unattended security upgrades.

## 3. Ship the code and configure

```bash
# from the repository root on your machine
./deploy/ecs/deploy.sh user@ECS_IP key.pem
```

The script rsyncs the repo (excluding node_modules/data/backups/.env) to
`/opt/aioption`, then rebuilds and restarts the container.

Then create the environment file **on the server**:

```bash
ssh -i key.pem user@ECS_IP
cd /opt/aioption
cp .env.testnet.example .env
nano .env        # set TRON_DEPOSIT_ADDRESS, TRON_USDT_CONTRACT_ADDRESS (testnet!)
```

## 4. Start / stop / logs

```bash
docker compose -f docker-compose.prod.yml up -d --build   # start
docker compose -f docker-compose.prod.yml logs -f app     # logs
docker compose -f docker-compose.prod.yml down            # stop
```

## 5. Open the app (SSH tunnel)

```bash
ssh -i key.pem -L 8080:localhost:8080 user@ECS_IP
# then browse to http://localhost:8080
```

The Host-header guard and CORS/CSRF guard already treat localhost as the app
origin, so the tunnel needs no extra configuration.

## 6. Health check

```bash
./deploy/ecs/healthcheck.sh user@ECS_IP key.pem
# or on the server: curl -fsS http://127.0.0.1:8080/api/health
```

The JSON includes the safety posture (`mode`, `tronMode`,
`liveTronWithdrawalsEnabled`, `binaryLiveTradingEnabled`,
`aiBinaryLiveAutoTradingEnabled`, `adminApiEnabled`) — all must be
`TESTNET`/`SHASTA`/`false` on the UAT deployment.

## 7. UAT reset (on the server)

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -e UAT_RESET_CONFIRM=YES -e UAT_RESET_STARTING_BALANCE_USDT=1000 \
  app node apps/server/dist/scripts/resetUat.js
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  app node apps/server/dist/scripts/verifyUat.js
docker compose -f docker-compose.prod.yml start app
```

The CLI backs the database up to `/app/backups` (the `aioption-backups`
volume) before wiping. To copy backups off the box to Alibaba Cloud OSS, see
[backup-to-oss.md](backup-to-oss.md).

## 8. Going LIVE later (checklist)

1. `pnpm audit` clean, full test suite green, UAT checklist signed off.
2. `.env`: `MODE=LIVE`, `TRON_MODE=MAINNET`, mainnet RPC/explorer, real
   deposit + contract addresses, hot wallet address. The base currency is
   USDT (TRC20). For reference only, the commonly known mainnet USDT TRC20
   contract is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj0t` — independently verify it
   (e.g. on TronScan) before setting `TRON_USDT_CONTRACT_ADDRESS`.
3. `LIVE_MODE_CONFIRM=I_UNDERSTAND_REAL_FUNDS` — required to boot at all.
4. Real withdrawals only if unavoidable: `ENABLE_LIVE_TRON_WITHDRAWALS=true`,
   `TRON_HOT_WALLET_PRIVATE_KEY=…`, and
   `LIVE_WITHDRAWALS_CONFIRM=I_UNDERSTAND_LIVE_WITHDRAWALS`.
   Prefer manual withdrawals from an exchange/wallet you control instead.
