# Deploying aioption to Alibaba Cloud ECS (Phase 7.2)

Simplified HTTPS architecture on the **Nile Testnet**: one app container
(Fastify API + built React UI on port **8080**, internal only) behind **Caddy**
(the only public entry point: 80 → redirect/ACME, 443 → HTTPS UI + `/api`).

```
browser ── https://yourdomain.com ──► caddy :443 ──► app :8080 (loopback only)
                                           :80  → redirect to HTTPS + Let's Encrypt ACME
```

- UI and API share one public origin: `https://yourdomain.com/` serves the
  React app, `https://yourdomain.com/api/…` serves the API (relative `/api`
  paths, no CORS needed, SSE streamed, WebSockets supported).
- Port **8080 is never public**; port **5173 is not used** in production.
- **Phase 7.3: no username/password** — the site opens directly for the
  temporary testnet period (≤ 2 weeks). See the security warning below.
- Local rehearsal of the exact same stack needs no domain and no Node.js:
  `docker compose -f docker-compose.local.yml up --build` →
  `https://localhost:8443`.

## 0. Security group (Alibaba Cloud)

Allow inbound:

| Port | Source | Why |
|---|---|---|
| 22/tcp | **your IP only** | SSH administration |
| 80/tcp | internet | HTTP→HTTPS redirect + Let's Encrypt ACME challenge |
| 443/tcp (+udp) | internet | HTTPS UI + API (Caddy) |

**Never** expose **8080** (app) or **5173** (Vite dev) to the internet — the
compose file binds 8080 to `127.0.0.1` only; keep the security group closed so
`http://yourdomain.com:8080` times out. SQLite files, backups, `.env` and the
Docker daemon must never be reachable over the network (they aren't, by
default — no shared volumes are served by Caddy, the app only serves
`apps/web/dist`).

## 1. Create the ECS instance

- Image: **Ubuntu 24.04** (or Alibaba Cloud Linux 3), 1 vCPU / 1–2 GiB.
- A real domain with a **DNS A record pointing at the ECS public IP**
  (required for the Let's Encrypt certificate).
- Create a non-root sudo user (or use `root` for setup, then harden SSH).

## 2. One-time server setup

```bash
scp -i key.pem -r deploy user@ECS_IP:~/
ssh -i key.pem user@ECS_IP 'sudo bash ~/deploy/ecs/setup.sh'
```

`setup.sh` installs Docker Engine + the compose plugin, creates
`/opt/aioption`, and enables unattended security upgrades.

## 3. Ship the code

```bash
# from the repository root on your machine
./deploy/ecs/deploy.sh user@ECS_IP key.pem
```

The script rsyncs the repo (excluding node_modules/data/backups/.env) to
`/opt/aioption`, then rebuilds and restarts the stack
(`docker-compose.testnet.yml`: `app` + `caddy`).

## 4. Create the environment file (on the server)

```bash
ssh -i key.pem user@ECS_IP
cd /opt/aioption
cp .env.nile.example .env
nano .env
```

Set at least:

```dotenv
PUBLIC_DOMAIN=yourdomain.com        # your real domain (DNS → ECS public IP)
ALLOWED_HOSTS=yourdomain.com,localhost,127.0.0.1,::1
MODE=TESTNET
TRON_MODE=NILE
TRON_DEPOSIT_ADDRESS=T…             # Nile testnet address (faucet TRX)
TRON_USDT_CONTRACT_ADDRESS=T…       # a Nile TEST token (USDT-TEST) — never mainnet USDT
```

### Temporary open access (Phase 7.3) — security warning

> ⚠️ **This testnet deployment temporarily allows public access without
> username and password. For production, authentication, IP restriction, or
> another access control mechanism should be reintroduced.**

**Recommended temporary mitigation:** if possible, restrict the Alibaba Cloud
security group for **TCP 443 to your trusted IP address** during the test
period.

No `BASIC_AUTH_USER` / `BASIC_AUTH_HASH` variables are used — do not set them.

Then lock down the file:

```bash
chmod 600 .env
```


## 5. Start / stop / logs

```bash
docker compose -f docker-compose.testnet.yml build
docker compose -f docker-compose.testnet.yml up -d
docker compose -f docker-compose.testnet.yml logs -f        # both services
docker compose -f docker-compose.testnet.yml down
```

Caddy waits for the app healthcheck (`GET /api/health`) before it starts
routing. On the first public request for the domain, Caddy obtains and
auto-renews the Let's Encrypt certificate (persisted in the `caddy_data`
volume).

## 6. Verify

```bash
# on the server — internal app health (loopback only)
curl http://127.0.0.1:8080/api/health

# from anywhere — public UI + API through Caddy (Phase 7.3: no credentials)
curl https://yourdomain.com/api/health
open https://yourdomain.com        # opens directly — no username/password

# http redirects to https
curl -I http://yourdomain.com      # → 308 → https://yourdomain.com

# the app port must NOT be publicly reachable — this must time out/fail:
curl --max-time 5 http://yourdomain.com:8080/api/health

# scripted posture check (also fails if any real-funds switch is on)
./deploy/ecs/healthcheck.sh user@ECS_IP key.pem
```

The health JSON must report `mode: TESTNET`, `tronMode: NILE`, and all
real-funds switches `false`.

## 7. Debugging the API directly (optional)

Port 8080 is loopback-only. If you need it locally, use an SSH tunnel:

```bash
ssh -i key.pem -L 8080:127.0.0.1:8080 user@ECS_IP
curl http://localhost:8080/api/health
```

## 8. UAT reset (clear the database before testnet validation)

```bash
cd /opt/aioption
docker compose -f docker-compose.testnet.yml stop app
docker compose -f docker-compose.testnet.yml run --rm --no-deps \
  -e UAT_RESET_CONFIRM=YES -e UAT_RESET_STARTING_BALANCE_USDT=1000 \
  app node apps/server/dist/scripts/resetUat.js
docker compose -f docker-compose.testnet.yml run --rm --no-deps \
  app node apps/server/dist/scripts/verifyUat.js
docker compose -f docker-compose.testnet.yml start app
```

The reset backs the database up to `/app/backups` (the `aioption-backups`
volume) before wiping, then seeds one clean account row (1000 USDT, trading
disabled); `verifyUat` asserts positions/transactions/deposits/withdrawals/
binary_contracts/ai_decisions/ai_binary_decisions/risk_events/
tron_fee_deposits are empty. To copy backups off the box to Alibaba Cloud OSS,
see [backup-to-oss.md](backup-to-oss.md).

## 9. Going LIVE later (checklist)

0. **Re-hardening (required before production):** reintroduce access control.
   Historical note — Phase 7.2 used Caddy basic auth: add a `basicauth` block
   to `deploy/caddy/Caddyfile.testnet` with a bcrypt hash generated via
   `docker run --rm caddy:2-alpine caddy hash-password --plaintext '…'`
   (keep the hash single-quoted in `.env` — bcrypt hashes contain `$`), or
   restrict TCP 443/80 in the security group to trusted IPs instead.
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
