#!/bin/bash
# E2E smoke test for AI Crypto Options MVP
BASE="http://localhost:3001/api/v1"
echo "=== 1. Health check ==="
curl -s $BASE/../../health
echo ""

echo "=== 2. Register user ==="
REGISTER=$(curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' -d '{"email":"test@example.com","password":"password123","jurisdiction":"US","riskAcknowledged":true}')
echo "$REGISTER" | head -c 400
echo ""

TOKEN=$(echo "$REGISTER" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch(e){console.log('')}})")

echo "=== 3. Get me ==="
curl -s $BASE/auth/me -H "Authorization: Bearer $TOKEN"
echo ""

echo "=== 4. Simulate USDC deposit of 100 ==="
curl -s -X POST $BASE/deposits/simulate -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"asset":"USDC","amount":"100"}'
echo ""

echo "=== 5. Get wallets with balance ==="
curl -s $BASE/wallets -H "Authorization: Bearer $TOKEN"
echo ""

echo "=== 6. Get trading settings ==="
curl -s $BASE/trading/settings -H "Authorization: Bearer $TOKEN"
echo ""

echo "=== 7. Enable auto trading ==="
curl -s -X PUT $BASE/trading/settings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"autoTradingEnabled":true,"maxTradeSizeUsd":"10","dailyLossLimitUsd":"20","maxOpenPositions":3,"minAiConfidence":0.5}'
echo ""

echo "=== 8. Request withdrawal ==="
curl -s -X POST $BASE/withdrawals -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"asset":"USDC","amount":"10","destinationAddress":"0xTestAddress"}'
echo ""

echo "=== 9. Get positions ==="
curl -s $BASE/positions -H "Authorization: Bearer $TOKEN"
echo ""

echo "TOKEN=$TOKEN" > /tmp/e2e-token.env