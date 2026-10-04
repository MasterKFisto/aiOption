# aioption

Personal AI crypto options trading web application (in progress).

> ⚠️ **DISCLAIMER**: Crypto options trading involves substantial risk. This
> project runs in **paper-trading mode** by default — no real funds are used.

## Monorepo layout

```
apps/
  server/        # backend (API, trading engine)
  web/           # frontend
packages/
  shared/        # shared types, schemas, constants
data/            # runtime data (gitignored)
backups/         # backups (gitignored)
```

## Docker-only development

The host machine has **no Node.js, npm, or pnpm installed**. The entire
toolchain (node 22 + pnpm) lives inside the `dev` container. Everything below
runs from the repository root.

### 1. Build & start the dev container

```bash
docker compose up -d --build
```

The container stays alive in the background (`tail -f /dev/null`). Check it:

```bash
docker compose ps
docker compose exec dev node -v    # v22.x
docker compose exec dev pnpm -v    # 12.8.1
```

### 2. Open a shell inside the container

```bash
docker compose exec dev bash
```

### 3. Install dependencies

```bash
docker compose exec dev pnpm install
```

### 4. Add packages

```bash
# workspace root (dependency)
docker compose exec dev pnpm add -w <pkg>

# workspace root (dev dependency, e.g. TypeScript 7)
docker compose exec dev pnpm add -wD typescript

# a specific workspace package
docker compose exec dev pnpm --filter @aioption/server add <pkg>

# or as a one-off throwaway container (same effect; changes persist via the bind mount)
docker compose run --rm dev pnpm add -wD <pkg>
```

### 5. Stop / tear down

```bash
docker compose stop        # stop, keep container
docker compose start       # start again
docker compose down        # remove the container (volume pnpm-store is kept)
```

## Backend (apps/server)

```bash
# start the Fastify dev server with hot reload (tsx watch)
docker compose exec dev pnpm dev:server

# health check
curl http://localhost:8080/api/health
```

Config lives in `apps/server/src/config.ts` (Zod-validated env vars, defaults in
`.env.example`; the `.env` at the repo root is injected into the container via
`env_file` in `docker-compose.yml`).

## Database (SQLite)

Single-user personal app → SQLite (no external DB server). The layer lives in
`apps/server/src/db`:

- `connection.ts` — opens `data/trading.db` (config `DB_PATH`), enables WAL mode
  and foreign keys, idempotent singleton.
- `migrations.ts` — creates `account` (single row id=1), `positions`,
  `transactions`, `ai_decisions`, `risk_events` on startup if missing.
- `repositories.ts` — typed CRUD backed by the interfaces in
  `@aioption/shared` (`packages/shared/src/types.ts`).

Install the driver (native — needs `allowBuilds` in pnpm-workspace.yaml):

```bash
docker compose exec dev pnpm --filter @aioption/server add better-sqlite3
docker compose exec dev pnpm --filter @aioption/server add -D @types/better-sqlite3
```

After editing `packages/shared`, rebuild it (the server consumes its `dist/`):

```bash
docker compose exec dev pnpm --filter @aioption/shared build
```

The DB file is runtime data and gitignored (`data/`); delete
`data/trading.db*` to reset.

## Paper trading

No real exchange yet — everything runs against the paper venue:

- `apps/server/src/execution/paperAdapter.ts` — `PaperExecutionAdapter`
  (implements the shared `ExecutionAdapter` interface): instant fills at the
  market price, 0.1% fee, in-memory open book with netting semantics, plus a
  `StaticPriceProvider` for fixed paper prices.
- `apps/server/src/services/walletService.ts` — paper wallet:
  `deposit` / `withdraw` / `lockFunds` / `unlockFunds`. Every movement updates
  the account and writes a `transactions` row.

Manual fund injection for testing:

```bash
curl -X POST http://localhost:8080/api/paper/deposit \
  -H 'Content-Type: application/json' \
  -d '{"amount":10000,"description":"initial paper funds"}'

curl -X POST http://localhost:8080/api/paper/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"amount":2500}'

curl http://localhost:8080/api/paper/balances
```

## Market data & signals (MVP)

Deterministic, simulated market data and a rule-based signal engine:

- `apps/server/src/market/marketDataService.ts` — `SimulatedMarketDataService`:
  seeded GBM hourly OHLCV candles + tickers for BTC/USDT and ETH/USDT
  (reproducible across runs), and `estimateVolatility()` (per-candle +
  annualized).
- `apps/server/src/strategy/signalEngine.ts` — rule-based `SignalEngine`:
  momentum over the last N candles; positive momentum + volatility below
  threshold → BULLISH, negative → BEARISH, otherwise NEUTRAL. Every decision
  (signal, confidence, expected return, proposed trade size — strictly
  `FIXED_TRADE_SIZE_USD` = $10 USDT) is persisted to `ai_decisions`.

```ts
// usage inside the container (e.g. via `pnpm dev:server` / scripts)
const market = new SimulatedMarketDataService();
const engine = new SignalEngine(market);
const decisions = engine.generateAll(); // one AiDecision per symbol, saved to the DB
```

## Tests

Vitest unit + integration tests (all inside the dev container, temp SQLite DBs):

```bash
docker compose exec dev pnpm test                      # run once (recursive)
docker compose exec dev pnpm --filter @aioption/server test
docker compose exec dev pnpm --filter @aioption/server test:watch   # watch mode
docker compose exec dev pnpm test:integration          # Phase 7 gate only
docker compose exec dev pnpm audit                     # no high/critical vulns
```

Test files live in `apps/server/test/` and are strictly typechecked via
`tsconfig.test.json` (part of `pnpm typecheck`).

## Risk engine & trading loop

Strict risk controls and a continuous paper-trading scheduler:

- `apps/server/src/risk/riskEngine.ts` — evaluates every `AiDecision` against
  the account (trading enabled, open-position capacity, fixed $10 trade size,
  sufficient cash balance). If equity falls to
  `startingEquity * (1 - lossLimitPercent/100)`, it closes all open positions,
  disables trading, and logs a `risk_event`.
- `apps/server/src/scheduler/tradingLoop.ts` — `setInterval` every 1 minute:
  market data → AI signal → risk engine → paper execution → wallet lock +
  position + executed-decision link. Starts on boot only when
  `trading_enabled` is set in the DB.

Control endpoints:

```bash
curl http://localhost:8080/api/trading/status
curl -X POST http://localhost:8080/api/trading/start    # requires funds
curl -X POST http://localhost:8080/api/trading/stop
curl -X PUT http://localhost:8080/api/trading/risk/settings \
  -H 'Content-Type: application/json' \
  -d '{"maxOpenPositions":3,"lossLimitPercent":8,"fixedTradeSizeUsd":10}'
```

## Frontend (apps/web)

React 18 + Vite + Ant Design + TanStack Query dashboard:

```bash
# dev server inside the container (published on localhost:5173)
docker compose exec dev pnpm dev:web
```

- Vite proxies `/api` to the Fastify backend on port 8080 (same container).
- Views: Dashboard (equity / available / locked / realized & unrealized PnL /
  trading status), Positions (open & closed), AI Decisions (signal, confidence,
  approval), Settings (risk limits, fixed trade size, trading on/off).

Install dependencies (inside the container):

```bash
docker compose exec dev pnpm --filter @aioption/web add react@18 react-dom@18 antd @ant-design/icons @tanstack/react-query
docker compose exec dev pnpm --filter @aioption/web add "@aioption/shared@workspace:*"
docker compose exec dev pnpm --filter @aioption/web add -D vite @vitejs/plugin-react @types/react@^18 @types/react-dom@^18 @types/node@^22
```

## Security notes

This is a **personal, local-only** application — protect it accordingly:

- Docker ports bind to `127.0.0.1` only (not reachable from the LAN).
- CORS is restricted to `CORS_ORIGIN` (default `http://localhost:5173`); the
  backend rejects browser requests from other origins. Use `*` only if you
  know what you're doing.
- No authentication exists — anyone with local machine access can control the
  app. Never expose these ports publicly.
- All SQL is parameterized; API inputs are Zod-validated and value-clamped.

## Real-time UI & Tron USDT (Phase 6.1)

**Live market data** (display-only; the trading loop keeps using the
deterministic simulated feed): the backend polls a public source (Coinbase)
every 3s (`MARKET_POLL_INTERVAL_MS`) for `MARKET_SYMBOL` (default BTC/USDT)
and falls back to `FALLBACK_MARKET_SYMBOL` (BTC/USD) when the pair is
unavailable — the UI labels the source and symbol accordingly.

```bash
curl http://localhost:8080/api/market/ticker
curl 'http://localhost:8080/api/market/candles?interval=1m&limit=300'
```

**Server-sent events** stream every account/trade/risk/decision/deposit/
withdrawal change to the dashboard (`GET /api/events`); TanStack Query
polling (3s) remains as a fallback.

**Tron USDT (TRC20)** — deposits and withdrawals are fixed to Tron/USDT/TRC20:

```bash
curl http://localhost:8080/api/deposits/info        # address, network, sync status
curl http://localhost:8080/api/deposits             # deposit history
curl -X POST http://localhost:8080/api/deposits/simulate -H 'Content-Type: application/json' -d '{"amount":500}'
curl http://localhost:8080/api/withdrawals          # withdrawal history
curl -X POST http://localhost:8080/api/withdrawals  -H 'Content-Type: application/json' \
  -d '{"amount":120,"destinationAddress":"T...","confirmed":true}'
```

- `TRON_MODE=SIMULATED` by default: nothing is ever broadcast; simulated
  deposits/withdrawals are recorded as network=TRON, asset=USDT, TRC20.
- Live modes (SHASTA/NILE/MAINNET) require explicit configuration
  (`TRON_DEPOSIT_ADDRESS`, `TRON_USDT_CONTRACT_ADDRESS`, optional
  `TRON_GRID_API_KEY`); withdrawals stay REQUESTED (never broadcast) unless
  `ENABLE_LIVE_TRON_WITHDRAWALS=true` AND the server-side
  `TRON_HOT_WALLET_PRIVATE_KEY` is configured. The private key is never
  exposed to the frontend. The hot wallet must hold TRX for energy/bandwidth.
- Duplicate deposits are never credited twice (unique `txid`).

The dashboard includes a live price panel + candlestick chart
(lightweight-charts, 1m/5m/1h), account summary with loss-limit floor and
daily loss remaining, open positions, recent decisions, risk events, deposit
(with QR code) and withdrawal modals, and a post-trade prompt (keep in wallet
or withdraw — toggled via `post_trade_prompt_enabled` in Settings, deduped in
localStorage).

## Binary options (Phase 6.2)

Short-duration (5s/10s) binary contracts settled **internally** against the
backend market price feed — never on-chain, no real exchange orders.
Deposits/withdrawals remain Tron USDT (TRC20). Toggle between **Classic
Options** and **Binary Options** tabs in the UI.

- `apps/server/src/binary/` — service, repository (atomic settlement),
  250ms settlement scheduler, routes.
- `GET /api/binary/config` · `GET /api/binary/quote?stake=&duration=&payoutRatio=`
  · `POST /api/binary/open` · `GET /api/binary/open` · `GET /api/binary/history`
  · `GET /api/binary/summary` · `GET /api/server-time`
- Payout ratios, stake limits, durations and the open-contract cap come from
  `BINARY_*` env vars (see `.env.example`). Loss-limit and risk checks apply;
  stale market data blocks opening and refunds unsettled contracts.
- The local `.env` uses `FALLBACK_MARKET_SYMBOL=BTC/USD` (Coinbase's liquid
  pair) so 5–10s contracts see real price movement; `BTC/USDT` remains the
  documented default.

## AI binary trading (Phase 6.3)

An AI module that generates short-term UP/DOWN/NEUTRAL signals from the live
tick buffer (momentum over 1/3/5/10s, short/long EMA direction, volatility,
freshness) and can automatically open Phase 6.2 binary contracts in
**AUTO_EXECUTE** mode. The real-time chart stays visible with AI signal and
trade markers.

**Modes** (default safe):

- `DISABLED` — no evaluation.
- `SIGNAL_ONLY` (default) — signals are generated, stored and displayed; no
  contracts are opened.
- `AUTO_EXECUTE` — after risk and confidence checks the AI opens binary
  contracts via the existing Phase 6.2 service (source `AI_BINARY`). Outside
  `PAPER` mode this requires `AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true`.

**Risk controls**: min confidence, signal persistence ticks, max open AI
contracts, min time between trades, cooldown after loss, max consecutive
losses, max session loss, max trades per hour, market-data staleness, and the
global loss floor. Every stop logs a risk event and an `ai-binary` SSE event.
AI decisions (every evaluation) and session stats are persisted in
`ai_binary_decisions` / `ai_binary_stats` / `ai_binary_settings`.

**Backend**: `apps/server/src/binary-ai/` — `binaryAiStrategy.ts` (deterministic
strategy, replaceable by an ML model later), `binaryAiService.ts` (loop +
risk chain), `binaryAiRepository.ts`, `binaryAiScheduler.ts`,
`binaryAiRoutes.ts`, `binaryAiTypes.ts`.

- `GET /api/binary-ai/status` · `PUT /api/binary-ai/settings`
  · `POST /api/binary-ai/start` · `POST /api/binary-ai/stop`
  · `GET /api/binary-ai/decisions` · `GET /api/binary-ai/stats`
  · `GET /api/market/ticks?limit=120` (1-second tick history for the chart)
- All `AI_BINARY_*` env vars are documented in `.env.example` and validated
  with Zod. The UI panel confirms before switching to AUTO_EXECUTE and shows a
  persistent high-risk warning.

## Phase 6.4 — expiry, limits, Tron visibility, fees, wallet records, profit target

- **Classic options**: explicit expiry (`expires_at`), 1/3/5/10-minute
  durations (default 5m), a 1-second settlement scheduler with a grace period
  and refund-on-stale behavior, and a manual ticket (`POST /api/options/open`,
  `GET /api/options/config`). Positions API returns `expiresAt`,
  `durationSeconds`, `secondsRemaining`, `settlementStatus`, `currentPrice`,
  `unrealizedPnl`. Ledger: `OPTION_STAKE_LOCKED` / `OPTION_SETTLE_WIN` /
  `OPTION_SETTLE_LOSS` / `OPTION_SETTLE_REFUND`; events `OPTION_EXPIRED_SETTLED`,
  `OPTION_EXPIRED_REFUNDED`, `OPTION_SETTLEMENT_PRICE_STALE`.
- **Limits**: max option stake 100 USDT (`MAX_OPTION_STAKE_USD`), daily loss
  limit default 40% (`DAILY_LOSS_LIMIT_PERCENT`, UI allows 0–80%; the migration
  only moves accounts still on the old 5% default).
- **Tron visibility**: sidebar indicator (Simulated/Shasta/Nile/Mainnet ·
  Connected/Degraded/Disconnected · readiness) with a status modal.
  `GET /api/tron/status` · `GET /api/tron/health` (persists checks to
  `tron_status_checks`) · `GET /api/tron/fee-estimate`. No secrets are exposed.
- **Withdrawal fees**: `TRON_WITHDRAWAL_FEE_POLICY` (HOT_WALLET_PAYS /
  DEDUCT_USDT_FROM_WITHDRAWAL / BLOCK_IF_INSUFFICIENT), `TRON_WITHDRAWAL_FEE_ESTIMATE_TRX`,
  `TRON_USD_TRX_PRICE`, `TRON_MIN_TRX_BALANCE_FOR_WITHDRAWAL`,
  `ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT`. The withdrawal modal shows the fee in
  TRX/USD, the payer, hot-wallet resources, and blocks (or marks PENDING_FEE)
  when resources are insufficient.
- **Wallet Records** page + `GET /api/wallet/records?type=&limit=&offset=` and
  `GET /api/wallet/records/:id`: unified deposits/withdrawals/trades/fees/
  refunds with status, txid, Tronscan links and a summary header.
- **AI profit target**: `AI_BINARY_PROFIT_TARGET_USD`,
  `AI_BINARY_DAILY_PROFIT_LIMIT_PERCENT`, `AI_BINARY_STOP_ON_PROFIT_TARGET`.
  The AI stops (STOPPED_BY_PROFIT_TARGET) when the session profit target or the
  daily profit limit is reached; events `AI_BINARY_PROFIT_TARGET_REACHED`,
  `AI_BINARY_DAILY_PROFIT_LIMIT_REACHED`, `AI_BINARY_STOPPED_BY_PROFIT_TARGET`;
  the UI shows profit stats and a keep/withdraw prompt.

## Phase 6.5 — unified account block, binary session gain, TRX fee wallet

- **Unified account block**: one shared `AccountSummaryBar` (equity, available,
  locked, unrealized/realized PnL, daily loss limit + remaining, loss floor,
  mode, trading status, binary session gain + limit, AI binary session profit)
  at the top of the Classic Options, Binary Options and Wallet Records pages.
  `GET /api/account` returns the unified fields; updates via SSE + 2s polling.
- **Binary Max Session Gain**: `BINARY_SESSION_GAIN_LIMIT_ENABLED`,
  `BINARY_MAX_SESSION_GAIN_USDT=50`, `BINARY_MAX_SESSION_GAIN_PERCENT=0`,
  `BINARY_SESSION_RESET_ON_START=true`. Manual + AI binary settlements feed a
  combined `binary_session_stats` session; reaching the limit blocks new
  manual contracts, stops AI auto-execution
  (`AI_BINARY_STOPPED_BY_SESSION_GAIN_LIMIT`), and shows a
  reset/keep/withdraw banner. Endpoints: `GET /api/binary/session-stats`,
  `PUT /api/binary/session-settings`, `POST /api/binary/session-reset`.
- **TRX fee wallet**: TRX deposits fund a separate network-fee reserve
  (never credited as USDT trading balance). `tron_fee_deposits` records +
  `GET /api/tron/fee-deposit-info` / `fee-status` / `fee-deposits` and
  `POST /api/tron/simulate-trx-deposit` (paper/simulated only). The fee
  reserve feeds the withdrawal fee gate and wallet records
  (`FEE_DEPOSIT` kind). UI: TRX fee deposit panel (address, QR, reserve,
  simulate button) on the Wallet Records page and the Tron status modal;
  the withdrawal modal links to it when the reserve is insufficient.

## Phase 7 — testnet mode, UAT reset & production deployment

**Testnet mode** runs the full app against a Tron *test* network (Shasta or
Nile) with zero real funds:

- `MODE=TESTNET` (alias of `TRADING_MODE`; `PRODUCTION` maps to `LIVE`)
  requires `TRON_MODE=SHASTA|NILE` — mainnet is rejected at startup.
- `MODE=LIVE` requires `LIVE_MODE_CONFIRM=I_UNDERSTAND_REAL_FUNDS`; real
  withdrawal broadcasts additionally need
  `LIVE_WITHDRAWALS_CONFIRM=I_UNDERSTAND_LIVE_WITHDRAWALS` plus the flag and
  a private key. Live withdrawals are **never** enabled without a key.
- `TRON_RPC_URL`/`TRON_EXPLORER_URL` must be https; a mainnet RPC is rejected
  unless `TRON_MODE=MAINNET`. `TRON_NETWORK_NAME` customises the label.
- The server probes the chain every 30 s (block height, TRX/energy/bandwidth
  of the fee wallet); status drops to DISCONNECTED/TRADE_BLOCKED when the
  probe fails or goes stale. The UI shows a persistent testnet banner and the
  Tron modal shows the network, latest block and explorer link.
- In TESTNET the internal ledger is test funds: simulated deposits and paper
  wallet operations stay enabled (they are blocked in LIVE only).

**UAT reset** wipes all application data while preserving the schema and the
saved addresses, then re-seeds a clean account (trading disabled):

```bash
docker compose run --rm dev sh -c 'cd /app && UAT_RESET_CONFIRM=YES \
  UAT_RESET_STARTING_BALANCE_USDT=1000 pnpm --filter @aioption/server reset:uat'
docker compose run --rm dev sh -c 'cd /app && pnpm --filter @aioption/server verify:uat'
```

The CLI backs the database up to `backups/` first, refuses to run without
`UAT_RESET_CONFIRM=YES`, and refuses LIVE mode unless
`UAT_RESET_ALLOW_LIVE=true`. An equivalent HTTP API
(`POST /api/admin/uat-reset`, `GET /api/admin/uat-verify`) exists but returns
404 unless `ENABLE_ADMIN_API=true`.

**Production** (`Dockerfile.prod` + `docker-compose.prod.yml`) builds one
non-root container serving the API **and** the built web UI on port 8080,
bound to loopback, with healthcheck, resource limits and `unless-stopped`
restart. Phase 7.2 adds the simplified public HTTPS stack on top:
`docker-compose.testnet.yml` runs that same app behind **Caddy** (TLS via
Let's Encrypt + basic auth) so the UI is reachable at
`https://yourdomain.com` and the API at `https://yourdomain.com/api`, while
8080 stays loopback-only. Alibaba Cloud ECS guide, setup/deploy/healthcheck
scripts and OSS backup instructions live in `deploy/ecs/`; the UAT gate
checklist is `docs/PRE_RELEASE_TEST_CHECKLIST.md` and the risk assessment is
`docs/CYBERSECURITY_RISK.md`.

```bash
cp .env.nile.example .env    # set PUBLIC_DOMAIN + BASIC_AUTH_HASH (see below)
docker compose -f docker-compose.testnet.yml up -d --build
# open https://yourdomain.com  (basic auth) — API: https://yourdomain.com/api/health
```

## Phase 7.1 — base currency USDT (USDC sunset on Tron)

USDC is no longer supported on the Tron network, so the base (accounting)
currency is **USDT (TRC20, 6 decimals — unchanged)**:

- `BASE_CURRENCY=USDT` is enforced at startup: `USDC` aborts with a clear
  deprecation error; any other value is rejected. The contract env var is
  `TRON_USDT_CONTRACT_ADDRESS` (the old `TRON_USDC_CONTRACT_ADDRESS` is gone).
- A startup migration converts existing rows in place (`account`,
  `deposits`, `withdrawals`, `transactions`, `positions`,
  `binary_contracts`, `ai_binary_decisions`; settings key
  `usdc_trade_address` → `usdt_trade_address`). Amounts, timestamps and
  statuses are untouched and the migration is idempotent. The TRX fee reserve
  stays TRX.
- Shared constants live in `packages/shared/src/currency.ts`
  (`BASE_CURRENCY_LABEL`, `BASE_CURRENCY_DECIMALS`, `TESTNET_TOKEN_SYMBOL`,
  `TESTNET_TOKEN_NAME`, `TESTNET_ASSET_NOTICE`, `TRON_DEPOSIT_WARNING`) and
  are imported by both backend and frontend.
- Testnet: there is no official USDT on Shasta/Nile — a test token stands in
  (labelled **USDT-TEST**, "Tether USD Test", 6 decimals). The UI marks it:
  "Testnet asset: USDT-TEST. This is a test token with no real value."
- No contract address is hardcoded. For reference only, the commonly known
  mainnet USDT TRC20 contract is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj0t` —
  independently verify it before any mainnet use.

## Phase 7.2 — simplified HTTPS testnet deployment (Caddy + Nile)

One public HTTPS entry point; the API stays internal:

```
browser ── https://yourdomain.com ──► caddy :443 ──► app :8080 (loopback only)
                                           :80  → redirect to HTTPS + Let's Encrypt
```

- The Fastify backend serves the built React UI itself (`WEB_DIST_DIR`), so no
  separate public frontend server (port 5173 is dev-only). The frontend calls
  the API with **relative `/api/…` paths** — same origin, no CORS, and the SSE
  feed (`/api/events`) streams through Caddy (`flush_interval -1`; WebSocket
  upgrades are automatic).
- **Caddy** is the only service with public ports: `80` (HTTP→HTTPS redirect +
  ACME challenge) and `443` (+udp for HTTP/3). Certificates from Let's Encrypt
  are automatic and persisted in the `caddy_data` volume. The whole site is
  behind **basic auth** (`PUBLIC_DOMAIN` / `BASIC_AUTH_USER` /
  `BASIC_AUTH_HASH` in `.env`).
- Port **8080 is bound to `127.0.0.1` only** — debug via SSH tunnel
  (`ssh -L 8080:127.0.0.1:8080 user@ECS_IP`), never publicly.

Files:

| File | Purpose |
|---|---|
| `docker-compose.testnet.yml` | ECS Nile deployment: `app` + `caddy` (80/443 public, app healthy-gated) |
| `docker-compose.local.yml` | Local rehearsal of the same stack — no domain, no Node.js on the host |
| `deploy/caddy/Caddyfile.testnet` | Public domain, Let's Encrypt, basic auth, proxy → `app:8080` |
| `deploy/caddy/Caddyfile.local` | `localhost` + Caddy internal CA, proxy → `app:8080` |
| `.env.nile.example` | Nile Testnet template (`TRON_MODE=NILE`, verified RPC/explorer URLs) |

Local test (Docker only):

```bash
cp .env.nile.example .env     # PUBLIC_DOMAIN=localhost works out of the box
docker compose -f docker-compose.local.yml up --build
# open https://localhost:8443 (accept the internal-CA warning)
# curl -k https://localhost:8443/api/health
```

ECS testnet deploy: see [deploy/ecs/README.md](deploy/ecs/README.md) —
`cp .env.nile.example .env` → set `PUBLIC_DOMAIN` + `BASIC_AUTH_HASH`
(`docker run --rm caddy:2-alpine caddy hash-password --plaintext '…'`; keep the
hash **single-quoted** in `.env` — bcrypt hashes contain `$`) →
`chmod 600 .env` → `docker compose -f docker-compose.testnet.yml up -d --build`.
Nile endpoints verified against the official TRON docs
(`https://nile.trongrid.io`, explorer `https://nile.tronscan.org`).

## TypeScript

Base strict config lives in `tsconfig.base.json` (TypeScript 7.x). Each package
extends it, e.g. `apps/server/tsconfig.json` (Node — may override
`moduleResolution` to `nodenext`) or `apps/web/tsconfig.json` (adds `DOM` lib).
