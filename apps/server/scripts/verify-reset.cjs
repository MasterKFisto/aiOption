// Read-only check that the database is in a clean (freshly reset) state.
// Usage (inside Docker): node apps/server/scripts/verify-reset.cjs
const Database = require('better-sqlite3');

const db = new Database('/app/data/trading.db', { readonly: true });
const counts = {};
for (const { name } of db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()) {
  counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '')}"`).get().n;
}
console.log('row counts:', JSON.stringify(counts));
// Rows that a fresh install creates by itself (account, startup session, settings seeds).
const system = new Set(['account', 'binary_session_stats', 'app_settings']);
const data = Object.entries(counts)
  .filter(([table]) => !system.has(table))
  .reduce((sum, [, n]) => sum + n, 0);
console.log('trading data rows:', data);
console.log('app_settings:', JSON.stringify(db.prepare('SELECT key, value FROM app_settings ORDER BY key').all()));
console.log(
  'account:',
  JSON.stringify(
    db
      .prepare(
        'SELECT equity, cash_balance, locked_balance, trading_enabled, loss_limit_percent, max_open_positions, option_default_duration_seconds FROM account',
      )
      .get(),
  ),
);
