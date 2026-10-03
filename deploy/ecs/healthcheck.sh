#!/usr/bin/env bash
# Phase 7 — remote health + safety-posture check for the ECS deployment.
# Usage: ./deploy/ecs/healthcheck.sh user@ECS_IP [key.pem]
# Exits non-zero when the app is unhealthy or any real-funds switch is on
# (unexpected on the testnet deployment).
set -euo pipefail

HOST="${1:?usage: healthcheck.sh user@ECS_IP [key.pem]}"
KEY="${2:-}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "${KEY}" ]; then
  SSH_OPTS+=(-i "${KEY}")
fi

# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "${HOST}" '
set -euo pipefail
body=$(curl -fsS http://127.0.0.1:8080/api/health)
echo "${body}" | python3 -m json.tool 2>/dev/null || echo "${body}"
echo "${body}" | grep -q "\"status\":\"ok\"" || { echo "UNHEALTHY" >&2; exit 1; }
for bad in \
  "\"liveTronWithdrawalsEnabled\":true" \
  "\"binaryLiveTradingEnabled\":true" \
  "\"aiBinaryLiveAutoTradingEnabled\":true"; do
  if echo "${body}" | grep -q "${bad}"; then
    echo "DANGER: real-funds switch enabled: ${bad}" >&2
    exit 2
  fi
done
docker inspect --format "container: {{.State.Status}} (health: {{.State.Health.Status}})" aioption 2>/dev/null || true
echo "OK: healthy, real-funds switches off"
'
