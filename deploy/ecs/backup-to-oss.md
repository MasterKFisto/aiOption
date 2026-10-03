# Backing up the SQLite database to Alibaba Cloud OSS (Phase 7)

The app stores everything in one SQLite database (`/app/data/trading.db` in
the container = the `aioption-data` volume). Backups land in `/app/backups`
(the `aioption-backups` volume). Ship them to OSS for off-box durability.

## 1. Install ossutil on the ECS host

```bash
curl -fsSL https://gosspublic.alicdn.com/ossutil/install.sh | sudo bash
ossutil config   # endpoint (e.g. oss-cn-hangzhou.aliyuncs.com) + RAM AccessKey pair
```

Use a **RAM user** whose policy allows only `oss:PutObject`/`oss:ListObjects`
on the backup bucket/prefix. Never use the root account keys.

## 2. Create the bucket (private, versioned)

- Bucket: e.g. `aioption-backups-<you>` — **Block Public Access: ON**.
- Enable versioning so an overwritten/deleted object is recoverable.
- Optional: lifecycle rule to expire noncurrent versions after 90 days.

## 3. Consistent backup script (server-side)

SQLite online backups must go through the `.backup` API (or the app's own
backup path) — copying the live file mid-write can corrupt it. The easiest
consistent copy is the app's UAT-reset backup or:

```bash
# /opt/aioption/deploy/ecs/backup-now.sh — run via cron on the host
#!/usr/bin/env bash
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/aioption/docker-compose.prod.yml exec -T app \
  node -e "const db=require('/app/apps/server/node_modules/better-sqlite3')(process.env.DB_PATH||'/app/data/trading.db');db.backup('/app/backups/trading-'+process.argv[1]+'.db').then(()=>process.exit(0)).catch(()=>process.exit(1))" \
  "${stamp}"
ossutil cp "/var/lib/docker/volumes/aioption-backups/_data/trading-${stamp}.db" \
  "oss://aioption-backups-<you>/db/trading-${stamp}.db"
```

Simpler alternative: back up the **volume** when the container is stopped
(nightly `docker compose … stop app && tar czf … && start app`) — stop-the-world
is acceptable for a personal app and guarantees consistency.

## 4. Cron

```cron
17 3 * * * /opt/aioption/deploy/ecs/backup-now.sh >> /var/log/aioption-backup.log 2>&1
```

## 5. Restore

```bash
ossutil cp oss://aioption-backups-<you>/db/trading-<stamp>.db /tmp/restore.db
docker compose -f docker-compose.prod.yml stop app
cp /tmp/restore.db /var/lib/docker/volumes/aioption-data/_data/trading.db
docker compose -f docker-compose.prod.yml start app
```

Verify after restore: `docker compose … run --rm --no-deps app node apps/server/dist/scripts/verifyUat.js`
(or just open the dashboard and check the account balance).
