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

## TypeScript

Base strict config lives in `tsconfig.base.json` (TypeScript 7.x). Each package
extends it, e.g. `apps/server/tsconfig.json` (Node — may override
`moduleResolution` to `nodenext`) or `apps/web/tsconfig.json` (adds `DOM` lib).
