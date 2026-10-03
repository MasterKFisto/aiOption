# Cybersecurity Risk Assessment (Phase 7)

Scope: personal, single-user, Docker-only deployment on Alibaba Cloud ECS.
The API/UI bind to **127.0.0.1** and are reached via SSH tunnel. This is the
primary network control; everything else is defense in depth.

## Assets

| Asset | Sensitivity | Protection |
|---|---|---|
| `TRON_HOT_WALLET_PRIVATE_KEY` | **Critical** — controls real funds | env-only, never logged, never returned by any endpoint; required only for live withdrawal broadcast; absence hard-disables broadcasting |
| SQLite DB (`data/trading.db`) | High — funds ledger | loopback-only API, container volume with 0600 backups, schema migrations, foreign keys, WAL |
| ECS SSH access | Critical | key-only auth, non-root user, security group limited to your IP |
| TronGrid API key | Low (quota only) | env-only, sent server-side only |

## Implemented controls

- **Network**: loopback-only port binding (`127.0.0.1:8080`), SSH tunnel
  access, ECS security group exposes only 22/tcp. No TLS needed inside a
  loopback tunnel (SSH provides confidentiality); do not publish the port.
- **Request guards** (`security/requestGuard.ts`): Host-header allowlist
  (DNS rebinding) and origin checks on all state-changing requests (CSRF);
  localhost/127.0.0.1/[::1] are treated as one origin. CORS is an explicit
  allowlist; credentials are not used (no cookies — CSRF risk is minimal).
- **Input validation**: every route body/query validated with Zod; numeric
  bounds enforced (e.g. paper amounts ≤ 1,000,000).
- **Secrets hygiene**: private key never logged; probe errors truncated and
  stripped of URLs/keys; `/api/health` exposes only booleans; fee/tron
  endpoints contain no key material (regression-tested).
- **Real-funds gates** (Phase 7, fail-fast at boot):
  `MODE=LIVE` needs `LIVE_MODE_CONFIRM`; live broadcasts need
  `ENABLE_LIVE_TRON_WITHDRAWALS=true` **and** a private key **and**
  `LIVE_WITHDRAWALS_CONFIRM`; `MODE=TESTNET` refuses mainnet RPC/networks;
  AI auto-execution in LIVE needs `AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true`;
  binary settlement is always on the internal ledger.
- **Test-funds isolation**: simulated/paper balance operations are allowed
  only when `SIMULATION_ALLOWED` (PAPER, TESTNET, or SIMULATED Tron) — never
  in LIVE. Testnet mode is startup-guaranteed to use a test network.
- **Admin surface**: UAT reset API returns 404 unless `ENABLE_ADMIN_API=true`;
  the destructive reset additionally requires `confirm: "YES"` and refuses
  LIVE mode unless explicitly overridden; CLI path backs up before wiping.
- **Web serving (prod)**: static root limited to `apps/web/dist` (dotfiles
  denied), CSP (`script-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`), `Cache-Control: no-cache` on HTML, immutable
  hashed assets. Unknown `/api/*` routes stay JSON 404.
- **Supply chain**: `pnpm audit` gate; `axios>=1.20.0` override; lockfile
  frozen in CI/deploy; dependencies pinned via the lockfile.
- **Container**: non-root user (uid 1001), resource limits (1 CPU / 512 MiB /
  256 pids), `unless-stopped` restart, healthcheck, read-only source tree
  inside the image.

## Residual risks (accepted, with mitigations)

| Risk | Impact | Mitigation / acceptance |
|---|---|---|
| No application authentication | Anyone with the SSH tunnel (or local access to the ECS host) can operate the app | Personal single-user app; SSH is the auth boundary. Do not expose 8080 beyond loopback. |
| In TESTNET, simulated deposits mint internal balance | Cosmetic only — the internal ledger is test funds; no on-chain value | Gated off in LIVE; documented in the UI banner. |
| Deposit detection trusts TronGrid data | A malicious RPC could fake USDT credits | Credits only count toward a test ledger in TESTNET; for LIVE use your own node or a trusted provider + confirmations (12). |
| SQLite on a single disk | Host loss = data loss | Nightly OSS backup (deploy/ecs/backup-to-oss.md), pre-reset backups. |
| Unpatched base image | Container escape (low) | Rebuild regularly (`deploy.sh` rebuilds), unattended host upgrades, non-root runtime. |
| `.env` on the host | Key material at rest | Host disk encryption; 0600 permissions; never committed (git-ignored). |
| DoS against the API via tunnel | App slowdown | Rate risk accepted (single user); container CPU/mem/pid limits cap blast radius. |

## Incident quick reference

- **Key suspected leaked**: stop the container, move funds with a wallet you
  control, rotate the key, redeploy.
- **Bad state**: `stop app` → restore from `/app/backups` or OSS → `start app`.
- **Unexpected LIVE flags**: `deploy/ecs/healthcheck.sh` exits non-zero when
  any real-funds switch is enabled on the testnet deployment.
