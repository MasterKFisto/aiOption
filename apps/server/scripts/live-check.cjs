// Read-only diagnostics for a live run (Phase 6.5.2 verification).
// Usage (inside Docker): node apps/server/scripts/live-check.cjs <sinceIso>
const Database = require('better-sqlite3');

const since = process.argv[2] ?? new Date(Date.now() - 15 * 60_000).toISOString();
const db = new Database('/app/data/trading.db', { readonly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);

console.log('since', since);
console.log('AI trades by side:', all("SELECT side, COUNT(*) n FROM positions WHERE source = 'AI' AND opened_at >= ? GROUP BY side", since));
console.log(
  'sequence:',
  all("SELECT side FROM positions WHERE source = 'AI' AND opened_at >= ? ORDER BY opened_at", since)
    .map((r) => r.side[0])
    .join(''),
);
console.log(
  'decisions:',
  all(
    "SELECT json_extract(features_json, '$.finalSignal') f, executed e, json_extract(features_json, '$.marketSource') src, COUNT(*) n FROM ai_decisions WHERE created_at >= ? GROUP BY f, e, src",
    since,
  ),
);
console.log(
  'execution rejections:',
  all(
    "SELECT substr(json_extract(features_json, '$.rejectionReason'), 1, 60) r, COUNT(*) n FROM ai_decisions WHERE created_at >= ? AND json_extract(features_json, '$.rejectionReason') IS NOT NULL GROUP BY r",
    since,
  ),
);
console.log(
  'stale / refund events:',
  all(
    "SELECT type, COUNT(*) n FROM risk_events WHERE triggered_at >= ? AND type IN ('OPTION_SETTLEMENT_PRICE_STALE','OPTION_EXPIRED_REFUNDED','AI_BINARY_MARKET_DATA_STALE','BINARY_MARKET_DATA_STALE') GROUP BY type",
    since,
  ),
);
console.log('AI settlements:', all("SELECT settlement_status s, COUNT(*) n FROM positions WHERE source = 'AI' AND settled_at >= ? GROUP BY s", since));
const account = get('SELECT cash_balance c, locked_balance l, equity e, max_open_positions m FROM account');
const classic = get("SELECT ROUND(COALESCE(SUM(stake_usd), 0), 2) s, COUNT(*) n FROM positions WHERE status = 'OPEN'");
const binary = get("SELECT ROUND(COALESCE(SUM(stake_usd), 0), 2) s FROM binary_contracts WHERE status = 'OPEN'");
console.log('account', account, 'open classic', classic, 'open binary stakes', binary.s);
console.log('locked == open stakes:', Math.abs(account.l - (classic.s + binary.s)) < 0.005);
