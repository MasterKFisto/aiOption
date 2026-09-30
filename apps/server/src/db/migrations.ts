import type Database from 'better-sqlite3';

/**
 * Idempotent schema bootstrap: creates every table if it does not exist and
 * seeds the single account row (id = 1). Runs automatically on startup.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS account (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  mode                 TEXT    NOT NULL DEFAULT 'PAPER',
  equity               REAL    NOT NULL DEFAULT 0,
  cash_balance         REAL    NOT NULL DEFAULT 0,
  locked_balance       REAL    NOT NULL DEFAULT 0,
  base_currency        TEXT    NOT NULL DEFAULT 'USD',
  fixed_trade_size_usd REAL    NOT NULL DEFAULT 100,
  max_open_positions   INTEGER NOT NULL DEFAULT 5,
  loss_limit_percent   REAL    NOT NULL DEFAULT 5,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT    NOT NULL,
  side          TEXT    NOT NULL CHECK (side IN ('CALL', 'PUT')),
  strike_price  REAL    NOT NULL,
  expiry        TEXT    NOT NULL,
  quantity      REAL    NOT NULL,
  entry_premium REAL    NOT NULL,
  exit_premium  REAL,
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  realized_pnl  REAL,
  opened_at     TEXT    NOT NULL,
  closed_at     TEXT,
  created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions (status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions (symbol);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  currency    TEXT    NOT NULL,
  description TEXT,
  position_id INTEGER REFERENCES positions (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at);

CREATE TABLE IF NOT EXISTS ai_decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  confidence  REAL    NOT NULL,
  rationale   TEXT,
  executed    INTEGER NOT NULL DEFAULT 0 CHECK (executed IN (0, 1)),
  position_id INTEGER REFERENCES positions (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_created_at ON ai_decisions (created_at);

CREATE TABLE IF NOT EXISTS risk_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT    NOT NULL,
  message           TEXT    NOT NULL,
  equity_at_trigger REAL    NOT NULL,
  triggered_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_risk_events_triggered_at ON risk_events (triggered_at);
`;

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA);

  // Schema drift fix for databases created before `locked_balance` existed.
  if (!hasColumn(db, 'account', 'locked_balance')) {
    db.exec('ALTER TABLE account ADD COLUMN locked_balance REAL NOT NULL DEFAULT 0');
  }

  // Seed the single-row account; INSERT OR IGNORE keeps it idempotent.
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO account (id, created_at, updated_at) VALUES (1, ?, ?)').run(
    now,
    now,
  );
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ReadonlyArray<{ name: string }>;
  return rows.some((row) => row.name === column);
}
