# AI Crypto Options MVP

AI-assisted cryptocurrency options trading web application with paper trading by default.

## ⚠️ DISCLAIMER

**Crypto options trading involves substantial risk. Automated trading does not guarantee profit. You may lose some or all of your deposited funds.**

This MVP operates in **paper trading mode** by default. No real funds are used. No real blockchain transactions are executed. No private keys are stored. This is a simulation environment designed for demonstration and development purposes only.

## Architecture

```
ai-crypto-options-mvp/
├── apps/
│   ├── api/          # Fastify TypeScript backend
│   └── web/          # React Vite frontend
├── packages/
│   └── shared/       # Shared Zod schemas, types, constants
├── docker-compose.yml
└── README.md
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand |
| Backend | Fastify, TypeScript, Zod, Prisma ORM, Pino |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7 |
| Blockchain | viem (types/utilities only, no live transactions) |
| AI Engine | Mock deterministic signal generator (pluggable) |

## Quick Start

### Prerequisites
- Node.js 22+
- pnpm 9+
- Docker & Docker Compose

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL and Redis
#    Option A: Docker
pnpm db:up
#    Option B: Homebrew (macOS)
brew install postgresql@16 redis
brew services start postgresql@16 redis
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "CREATE ROLE app WITH LOGIN PASSWORD 'app';"
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "CREATE DATABASE ai_options OWNER app;"
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "ALTER ROLE app CREATEDB;"

# 3. Copy environment file
cp .env.example .env

# 4. Run database migrations
pnpm db:migrate

# 5. (Optional) Seed the admin user
pnpm db:seed

# 6. Start development servers
pnpm dev
```

- Backend API: http://localhost:3001
- Frontend: http://localhost:5173
- Health check: http://localhost:3001/health
- API Docs: http://localhost:3001/docs
- Prisma Studio: `pnpm db:studio`

### E2E Smoke Test

After starting the API, verify the full user flow:

```bash
bash e2e-smoke-test.sh
```

This registers a test user, simulates a USDC deposit, enables auto trading,
requests a withdrawal, and verifies positions appear once the trading loop runs.
Set the admin user to `ADMIN_EMAIL` (default `admin@example.com`) to approve withdrawals.

### Docker Deployment

```bash
# Build and start all services
docker compose up --build

# Access the app at http://localhost
```

## Environment Variables

See `.env.example` for all configuration options. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://app:app@localhost:5432/ai_options` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `JWT_SECRET` | `change_me` | JWT signing secret (CHANGE IN PRODUCTION) |
| `ADMIN_EMAIL` | `admin@example.com` | Admin user email |
| `PAPER_TRADING` | `true` | Enable paper trading mode |
| `LIVE_TRADING_ENABLED` | `false` | Live trading (disabled by default) |
| `TRADING_LOOP_ENABLED` | `true` | Enable background trading loop |
| `DEFAULT_MAX_TRADE_USD` | `10` | Max option premium per trade |
| `WALLET_MODE` | `PAPER` | Wallet mode (PAPER/METAMASK/SMART_WALLET) |
| `OPTIONS_VENUE_MODE` | `PAPER` | Options venue (PAPER/TESTNET/LIVE) |
| `AI_ENGINE_MODE` | `MOCK` | AI engine (MOCK/OPENAI/CUSTOM) |

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Get current user

### Wallets & Deposits
- `GET /api/v1/wallets` - List wallets
- `GET /api/v1/wallets/:id/balance` - Get wallet balance
- `POST /api/v1/deposits/simulate` - Simulate deposit
- `GET /api/v1/deposits` - List deposits

### Withdrawals
- `POST /api/v1/withdrawals` - Request withdrawal
- `GET /api/v1/withdrawals` - List withdrawals

### Trading
- `GET /api/v1/trading/settings` - Get trading settings
- `PUT /api/v1/trading/settings` - Update trading settings

### Positions & Orders
- `GET /api/v1/positions` - Get all positions
- `GET /api/v1/positions/open` - Get open positions
- `GET /api/v1/orders` - Get order history

### Admin
- `GET /api/v1/admin/users` - List users
- `GET /api/v1/admin/withdrawals` - List withdrawals
- `POST /api/v1/admin/withdrawals/:id/approve` - Approve withdrawal
- `POST /api/v1/admin/withdrawals/:id/reject` - Reject withdrawal
- `POST /api/v1/admin/trading/kill-switch` - Activate kill switch

## Paper Trading Explanation

The MVP operates entirely in paper trading mode:

1. **Paper Wallet**: Users get a simulated wallet. Balances are managed via double-entry ledger.
2. **Paper Deposits**: Credits to the ledger without blockchain confirmation.
3. **Paper Options Venue**: Simulates option pricing, order execution, settlement.
4. **Mock AI Engine**: Deterministic signal generator based on time-based seed.
5. **No Real Transactions**: No blockchain RPC calls unless explicitly configured.

## Safety Features

- Paper trading by default
- No private key storage
- Double-entry ledger for all balances
- Risk engine validates every trade
- Configurable max trade size
- Daily/weekly loss limits
- Max open positions limit
- Admin kill switch for emergency stop
- Withdrawal approval workflow (2-step)
- Zombie validation on all API boundaries

## Security Warnings

⚠️ **DO NOT** use this MVP with real funds without:
1. A comprehensive security audit
2. Proper key management (HSM/MPC)
3. Real options venue integration testing
4. Rate limiting and DDoS protection
5. Penetration testing
6. Regulatory compliance review
7. Insurance coverage

## Next Steps for Production

1. Replace mock AI with real ML models or API integration
2. Integrate real options venues (Deribit, Lyra, etc.)
3. Add real wallet support (AA, MPC, or MetaMask)
4. Implement proper KYC/AML
5. Add comprehensive monitoring and alerting
6. Set up CI/CD pipeline with automated testing
7. Deploy with proper secrets management
8. Add circuit breakers for market volatility
9. Implement proper position hedging strategies
10. Add multi-language support

## Testing

```bash
# Run all tests (decimal arithmetic, ledger service, risk engine)
pnpm test
```

Test suites:
- `apps/api/__tests__/decimal.test.ts` - decimal-safe money arithmetic
- `apps/api/__tests__/ledger.test.ts` - double-entry ledger service (account creation, entries, balance calculation, lock/unlock validation)
- `apps/api/__tests__/risk-engine.test.ts` - risk engine checks (auto-trading, asset allowlist, confidence threshold, trade size, balance, position limits)

## Verified Acceptance Criteria

The following have been verified end-to-end on this project:

1. ✅ `pnpm install` completes successfully
2. ✅ `pnpm dev` starts backend (:3001) and frontend (:5173)
3. ✅ `GET /health` returns OK
4. ✅ User registration and login (JWT auth)
5. ✅ USDC paper deposit simulation
6. ✅ Wallet balance from double-entry ledger
7. ✅ Trading settings configuration (GET/PUT)
8. ✅ Auto trading start/stop
9. ✅ Trading loop generates mock AI signals every 30s
10. ✅ Risk engine validates signals (10 checks)
11. ✅ Paper venue executes trades (order + position atomic)
12. ✅ Positions appear in API
13. ✅ Ledger entries: DEPOSIT, OPTION_PREMIUM_PAID, PLATFORM_FEE, WITHDRAWAL lock/unlock
14. ✅ Withdrawal request → admin approve → complete
15. ✅ Admin kill switch stops the trading loop
16. ✅ TypeScript strict mode passes
17. ✅ ESLint passes (0 errors, 0 warnings)
18. ✅ 23 unit tests pass (decimal, ledger, risk engine)
19. ✅ No private keys required
20. ✅ No real blockchain transactions (paper trading by default)

## License

Proprietary - All rights reserved