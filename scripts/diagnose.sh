#!/usr/bin/env bash
# ============================================
# aioption — Phase 7.4.1 deployment diagnostics (Docker-only)
#
# Checks: container status, backend env, /api/health + UI inside the app
# container, Caddyfile validity, Caddy logs, published ports, Nile testnet
# config, and the USDT token contract status. No host Node.js required.
#
# Usage (from the repository root on the server):
#   ./scripts/diagnose.sh            # uses docker-compose.testnet.yml
#   bash scripts/diagnose.sh         # same, without exec permission
#   COMPOSE_FILE=docker-compose.local.yml bash scripts/diagnose.sh
#   ENV_FILE=.env.mine bash scripts/diagnose.sh   # non-default env file
# ============================================

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.testnet.yml}"
ENV_FILE="${ENV_FILE:-}"
if [ -n "${ENV_FILE}" ]; then
  DC="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE}"
else
  DC="docker compose -f ${COMPOSE_FILE}"
fi

PASS=0
FAIL=0
GREP_FOR=""

ok()   { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  ✗ %s\n' "$1"; }
note() { printf '  · %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

# Runs a command; ok when it exits 0 and its output contains $GREP_FOR (if set).
run() { # name command...
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    if [ -n "${GREP_FOR}" ] && ! printf '%s' "$out" | grep -q "${GREP_FOR}"; then
      bad "${name} — expected to find '${GREP_FOR}'"
    else
      ok "${name}"
    fi
  else
    bad "${name}"
  fi
  [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/     /' | head -6
  GREP_FOR=""
}

if ! docker info > /dev/null 2>&1; then
  echo 'ERROR: Docker is not available.' >&2
  exit 1
fi

section "1. Container status (${COMPOSE_FILE})"
if out="$(${DC} ps 2>&1)" && [ -n "$out" ] && printf '%s' "$out" | grep -q 'app'; then
  printf '%s\n' "$out" | sed 's/^/     /'
  printf '%s' "$out" | grep -q 'app' && ok 'app container present' || bad 'app container missing'
  printf '%s' "$out" | grep -q 'caddy' && ok 'caddy container present' || bad 'caddy container missing'
  printf '%s' "$out" | grep -iE 'app' | grep -qiE 'up|running' && ok 'app is running' || bad 'app is not running'
  printf '%s' "$out" | grep -iE 'caddy' | grep -qiE 'up|running' && ok 'caddy is running' || bad 'caddy is not running'
else
  bad "no containers — is the stack up? (docker compose -f ${COMPOSE_FILE} up -d)"
fi

section "2. Backend environment (secrets are never printed)"
if out="$(${DC} exec -T app sh -c 'printenv | grep -E "^(HOST|PORT|NODE_ENV|MODE|TRON_MODE|TRON_NETWORK_NAME|TRON_RPC_URL|TRON_EXPLORER_URL|TRON_USDT_CONTRACT_ADDRESS|WEB_DIST_DIR)=" | sort; [ -n "${TRON_HOT_WALLET_PRIVATE_KEY:-}" ] && echo "TRON_HOT_WALLET_PRIVATE_KEY=SET (hidden)" || echo "TRON_HOT_WALLET_PRIVATE_KEY=EMPTY"' 2>&1)"; then
  printf '%s\n' "$out" | sed 's/^/     /'
  printf '%s' "$out" | grep -q '^HOST=0.0.0.0$' && ok 'HOST=0.0.0.0 (binds all container interfaces)' || bad 'HOST is not 0.0.0.0'
  printf '%s' "$out" | grep -q '^PORT=8080$' && ok 'PORT=8080' || bad 'PORT is not 8080'
  printf '%s' "$out" | grep -q '^MODE=TESTNET$' && ok 'MODE=TESTNET' || note 'MODE is not TESTNET'
  printf '%s' "$out" | grep -q '^TRON_MODE=NILE$' && ok 'TRON_MODE=NILE (Nile Testnet)' || bad 'TRON_MODE is not NILE'
  printf '%s' "$out" | grep -q '^WEB_DIST_DIR=apps/web/dist$' && ok 'WEB_DIST_DIR=apps/web/dist' || bad 'WEB_DIST_DIR is not apps/web/dist'
  if printf '%s' "$out" | grep -qE '^TRON_USDT_CONTRACT_ADDRESS=T.+'; then
    ok 'TRON_USDT_CONTRACT_ADDRESS is set'
  else
    bad 'TRON_USDT_CONTRACT_ADDRESS is empty — USDT deposits/withdrawals will not work'
  fi
else
  printf '%s\n' "$out" | sed 's/^/     /'
  bad 'cannot read the app container environment (is app running?)'
fi

section "3. Backend health inside the container (loopback)"
GREP_FOR='"status":"ok"'
run 'GET http://127.0.0.1:8080/api/health → status ok' \
  ${DC} exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{console.log('HTTP',r.status);console.log(await r.text())}).catch(e=>{console.error(e.message);process.exit(1)})"

section "4. Frontend inside the container (GET / serves the React UI)"
GREP_FOR='<title>'
run 'GET http://127.0.0.1:8080/ → index.html' \
  ${DC} exec -T app node -e "fetch('http://127.0.0.1:8080/').then(async r=>{const t=await r.text();console.log('HTTP',r.status);console.log(t.slice(0,200));if(!t.includes('<title>'))process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"

section "5. USDT token status inside the container (never fatal)"
if out="$(${DC} exec -T app node -e "fetch('http://127.0.0.1:8080/api/tron/token-status').then(async r=>{const j=await r.json();console.log('HTTP',r.status,'connected='+j.tokenConnected,'contract='+(j.tokenContractAddress||'(empty)'));if(j.errors.length)console.log('errors: '+j.errors.join(','));if(j.warnings.length)console.log('warnings: '+j.warnings.join(' | '))}).catch(e=>{console.error(e.message);process.exit(1)})" 2>&1)"; then
  printf '%s\n' "$out" | sed 's/^/     /'
  printf '%s' "$out" | grep -q 'HTTP 200' && ok '/api/tron/token-status returns HTTP 200' || bad 'token-status did not return 200'
  printf '%s' "$out" | grep -q 'connected=true' && ok 'USDT token connected' || note 'USDT token not connected — see errors above'
else
  printf '%s\n' "$out" | sed 's/^/     /'
  bad 'token-status request failed'
fi

section "6. Caddy configuration"
if out="$(${DC} exec -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1)"; then
  printf '%s\n' "$out" | tail -2 | sed 's/^/     /'
  ok 'Caddyfile is valid'
else
  printf '%s\n' "$out" | tail -4 | sed 's/^/     /'
  bad 'Caddyfile is INVALID — Caddy cannot serve HTTPS'
fi
domain="$(${DC} exec -T caddy printenv PUBLIC_DOMAIN 2>/dev/null || true)"
if [ -n "$domain" ]; then
  ok "PUBLIC_DOMAIN=${domain}"
  case "$domain" in
    *://*|*:*|*/*) bad 'PUBLIC_DOMAIN must be a bare host (e.g. yourdomain.com) — no scheme, port or path' ;;
  esac
else
  case "${COMPOSE_FILE}" in
    *local*) note 'PUBLIC_DOMAIN not set (not required by Caddyfile.local)' ;;
    *) bad 'PUBLIC_DOMAIN is empty — set it in .env' ;;
  esac
fi

section "7. Caddy logs (last 10 lines)"
${DC} logs --tail 10 caddy 2>&1 | sed 's/^/     /'

section "8. Published ports (8080 loopback-only, 443 public, no 5173)"
if out="$(${DC} ps 2>&1)" && printf '%s' "$out" | grep -q 'app'; then
  printf '%s\n' "$out" | sed 's/^/     /'
  printf '%s' "$out" | grep -i 'caddy' | grep -q '443' && ok 'caddy publishes 443' || bad 'caddy does not publish 443'
  if printf '%s' "$out" | grep -i 'app' | grep -q '0.0.0.0:.*->8080'; then
    bad 'app port 8080 is PUBLIC (0.0.0.0) — must be 127.0.0.1 only'
  else
    ok 'app port 8080 is not public'
  fi
  printf '%s' "$out" | grep -q '5173' && bad 'port 5173 is published (dev-only port)' || ok 'port 5173 is not published'
else
  bad 'cannot list published ports (is the stack up?)'
fi

printf '\n== Summary: %s passed, %s failed ==\n' "${PASS}" "${FAIL}"
[ "${FAIL}" -eq 0 ]
