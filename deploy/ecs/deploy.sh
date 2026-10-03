#!/usr/bin/env bash
# Phase 7 — deploy the repository to an ECS host and restart the app.
# Usage: ./deploy/ecs/deploy.sh user@ECS_IP [path/to/key.pem]
set -euo pipefail

HOST="${1:?usage: deploy.sh user@ECS_IP [key.pem]}"
KEY="${2:-}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "${KEY}" ]; then
  SSH_OPTS+=(-i "${KEY}")
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET=/opt/aioption

echo "==> syncing ${REPO_ROOT} → ${HOST}:${TARGET}"
rsync -az --delete \
  --exclude node_modules --exclude '*/node_modules' \
  --exclude .git --exclude data --exclude backups \
  --exclude .env --exclude 'apps/web/dist' --exclude 'apps/server/dist' \
  -e "ssh ${SSH_OPTS[*]}" \
  "${REPO_ROOT}/" "${HOST}:${TARGET}/"

echo '==> checking .env exists on the server'
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "${HOST}" "
  set -euo pipefail
  cd ${TARGET}
  if [ ! -f .env ]; then
    echo 'ERROR: ${TARGET}/.env missing — cp .env.testnet.example .env and edit it first' >&2
    exit 1
  fi
  echo '==> building and restarting the container'
  docker compose -f docker-compose.prod.yml up -d --build
  echo '==> waiting for health'
  for i in \$(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/api/health > /dev/null 2>&1; then
      echo 'healthy'
      curl -fsS http://127.0.0.1:8080/api/health
      exit 0
    fi
    sleep 2
  done
  echo 'ERROR: container did not become healthy' >&2
  docker compose -f docker-compose.prod.yml logs --tail 100 app >&2
  exit 1
"
