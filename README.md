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
curl http://localhost:3001/api/health
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
curl -X POST http://localhost:3001/api/paper/deposit \
  -H 'Content-Type: application/json' \
  -d '{"amount":10000,"description":"initial paper funds"}'

curl -X POST http://localhost:3001/api/paper/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"amount":2500}'

curl http://localhost:3001/api/paper/balances
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
  `FIXED_TRADE_SIZE_USD` = $10 USDC) is persisted to `ai_decisions`.

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
```

Test files live in `apps/server/test/` and are strictly typechecked via
`tsconfig.test.json` (part of `pnpm typecheck`).

## TypeScript

Base strict config lives in `tsconfig.base.json` (TypeScript 7.x). Each package
extends it, e.g. `apps/server/tsconfig.json` (Node — may override
`moduleResolution` to `nodenext`) or `apps/web/tsconfig.json` (adds `DOM` lib).
