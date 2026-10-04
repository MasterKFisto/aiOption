# Pre-release Test Checklist (Phase 7 UAT)

Run everything in Docker. Prerequisites: `docker compose up -d dev` with a
`.env` (see `.env.example`); testnet env in `.env.testnet.example`.

## 0. Automated gate (must be fully green)

```bash
docker compose exec -T dev sh -c 'cd /app && pnpm typecheck'
docker compose exec -T dev sh -c 'cd /app && pnpm --filter @aioption/server test'
docker compose exec -T dev sh -c 'cd /app && pnpm --filter @aioption/web test'
docker compose exec -T dev sh -c 'cd /app && pnpm --filter @aioption/web build'
docker compose exec -T dev sh -c 'cd /app && pnpm audit --audit-level high'
```

- [ ] typecheck clean (server + web + shared)
- [ ] server tests: all files pass (≥ 48 files / ≥ 350 tests)
- [ ] web tests: all pass (24)
- [ ] web production build succeeds
- [ ] `pnpm audit` reports no high/critical vulnerabilities

## 1. Fresh UAT environment (reset)

```bash
docker compose up -d --force-recreate dev   # after any .env change
docker compose run --rm dev sh -c 'cd /app && UAT_RESET_CONFIRM=YES \
  UAT_RESET_STARTING_BALANCE_USDT=1000 pnpm --filter @aioption/server reset:uat'
docker compose run --rm dev sh -c 'cd /app && pnpm --filter @aioption/server verify:uat'
```

- [ ] backup file created under `backups/`
- [ ] reset reports cleared rows and `UAT RESET OK`
- [ ] verify reports `VERIFY OK` (all data tables empty, schema intact)
- [ ] dashboard shows exactly the seeded starting balance, trading disabled

## 2. Testnet mode (Shasta or Nile)

Start with the testnet env (`MODE=TESTNET`, `TRON_MODE=SHASTA`,
`TRON_RPC_URL=https://api.shasta.trongrid.io`, no private key), then:

- [ ] UI shows the banner: “Testnet mode: using test network only. No real funds.”
- [ ] Banner + deposit modal mark the asset: “Testnet asset: USDT-TEST. This is
      a test token with no real value.”
- [ ] Balances, deposits, withdrawals and fee estimates all show USDT
      (base currency; 6 decimals); network fees stay in TRX
- [ ] no USDC label appears anywhere in the UI
- [ ] Tron status modal: network name, mode tag SHASTA/NILE, “test network”,
      explorer link, latest block, connection CONNECTED (after the first probe)
- [ ] readiness is WITHDRAWAL_BLOCKED (withdrawals disabled) — expected
- [ ] a test deposit is detected on-chain **or** simulated via the UI
- [ ] GET /api/health: `mode=TESTNET`, `tronMode=SHASTA`, all live flags false

## 3. Account & wallet

- [ ] paper deposit/withdraw adjust cash + equity (test ledger)
- [ ] wallet records list the movements
- [ ] withdrawal request flow validates addresses; broadcast stays disabled

## 4. Classic options

- [ ] start classic trading (confirmation prompt)
- [ ] open 10-minute CALL — only the stake locks
- [ ] position settles at expiry; WIN/LOSE/REFUND payout correct; funds released
- [ ] stop blocks new opens; open position keeps running

## 5. Binary options

- [ ] open 5 s UP contract — locked stake, countdown visible
- [ ] settles via the 250 ms scheduler; history shows result + payout
- [ ] summary counters (wins/losses/refunds) match history

## 6. AI binary

- [ ] SIGNAL_ONLY: signals appear, no contracts opened
- [ ] AUTO_EXECUTE works in TESTNET (internal ledger)
- [ ] in LIVE mode (config test only) AUTO_EXECUTE is refused without
      `AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true`

## 7. Safety guards (config, fail-fast)

- [ ] `BASE_CURRENCY=USDT` everywhere; `BASE_CURRENCY=USDC` aborts at startup
      with a clear deprecation error; other currencies are rejected
- [ ] existing USDC rows are migrated to USDT on startup (amounts unchanged)
- [ ] `MODE=TESTNET` + `TRON_MODE=MAINNET` → refuses to start
- [ ] `MODE=LIVE` without `LIVE_MODE_CONFIRM` → refuses to start
- [ ] LIVE + `ENABLE_LIVE_TRON_WITHDRAWALS=true` without
      `LIVE_WITHDRAWALS_CONFIRM` → refuses to start
- [ ] live withdrawals never enabled without a private key
- [ ] non-https or mainnet `TRON_RPC_URL` in a test mode → refuses to start
- [ ] admin API 404 unless `ENABLE_ADMIN_API=true`

## 8. Security spot checks

- [ ] cross-origin POST (evil origin) rejected with 403
- [ ] unknown Host header rejected with 403
- [ ] no response body contains `private`, secrets, or the TronGrid key
- [ ] CSP header present on the production UI; only `dist` files served
- [ ] `docs/CYBERSECURITY_RISK.md` reviewed and current

## 9. ECS deployment readiness

- [ ] `docker compose -f docker-compose.testnet.yml build` succeeds
- [ ] container healthy; UI reachable via
      `ssh -i key.pem -L 8080:localhost:8080 user@ECS_IP`
- [ ] `deploy/ecs/healthcheck.sh` passes and reports all live flags false
- [ ] UAT reset CLI works on the server (backup → reset → verify)
- [ ] backup copied to OSS per `deploy/ecs/backup-to-oss.md`

## 10. Phase 7.2/7.3 — HTTPS testnet deployment (Caddy + Nile)

- [ ] `docker compose -f docker-compose.local.yml up --build` works locally
      with no domain and no host Node.js
- [ ] `https://localhost:8443` loads the UI (accept internal-CA warning);
      `https://localhost:8443/api/health` returns 200 through the proxy —
      **no username/password prompt (Phase 7.3)**
- [ ] ECS: `https://yourdomain.com` loads the UI over a valid Let's Encrypt
      certificate **without any username/password prompt**; HTTP
      `http://yourdomain.com` redirects to HTTPS
- [ ] `https://yourdomain.com/api/health` returns 200 **without credentials**
- [ ] `http://yourdomain.com:8080/api/health` times out — 8080 not public;
      security group has only 22 (your IP) / 80 / 443; 5173 unused and not
      publicly reachable
- [ ] UI shows "Nile Testnet" in banner/sidebar and the USDT-TEST notice
      ("Nile Testnet mode: test network only. No real funds.")
- [ ] Caddy logs show no authentication/basicauth configuration errors
- [ ] SSE updates arrive through the proxy (live dashboard updates)
- [ ] UAT reset + verify run against the testnet compose stack
- [ ] Temporary security warning acknowledged: public access without
      credentials is accepted for the ≤ 2-week testnet window only; TCP 443
      restricted to a trusted IP where possible; access control must be
      reintroduced before production
