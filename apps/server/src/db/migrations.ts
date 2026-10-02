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
  base_currency        TEXT    NOT NULL DEFAULT 'USDC',
  fixed_trade_size_usd REAL    NOT NULL DEFAULT 10,
  max_open_positions   INTEGER NOT NULL DEFAULT 5,
  loss_limit_percent   REAL    NOT NULL DEFAULT 40,
  trading_enabled      INTEGER NOT NULL DEFAULT 0,
  starting_equity      REAL    NOT NULL DEFAULT 0,
  post_trade_prompt_enabled INTEGER NOT NULL DEFAULT 1,
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
  created_at    TEXT    NOT NULL,
  duration_seconds     INTEGER,
  expires_at           TEXT,
  settled_at           TEXT,
  settlement_price     REAL,
  settlement_status    TEXT,
  settlement_reason    TEXT,
  source               TEXT NOT NULL DEFAULT 'MANUAL'
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
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol                  TEXT    NOT NULL,
  signal                  TEXT    NOT NULL DEFAULT 'NEUTRAL',
  action                  TEXT    NOT NULL,
  confidence              REAL    NOT NULL,
  expected_return         REAL    NOT NULL DEFAULT 0,
  proposed_trade_size_usd REAL    NOT NULL DEFAULT 0,
  rationale               TEXT,
  executed                INTEGER NOT NULL DEFAULT 0 CHECK (executed IN (0, 1)),
  position_id             INTEGER REFERENCES positions (id) ON DELETE SET NULL,
  created_at              TEXT    NOT NULL
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

CREATE TABLE IF NOT EXISTS deposits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  network         TEXT    NOT NULL DEFAULT 'TRON',
  asset           TEXT    NOT NULL DEFAULT 'USDC',
  token_standard  TEXT    NOT NULL DEFAULT 'TRC20',
  amount          REAL    NOT NULL,
  from_address    TEXT,
  txid            TEXT    UNIQUE,
  status          TEXT    NOT NULL,
  confirmations   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  credited_at     TEXT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_deposits_created_at ON deposits (created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  network             TEXT    NOT NULL DEFAULT 'TRON',
  asset               TEXT    NOT NULL DEFAULT 'USDC',
  token_standard      TEXT    NOT NULL DEFAULT 'TRC20',
  amount              REAL    NOT NULL,
  destination_address TEXT    NOT NULL,
  status              TEXT    NOT NULL,
  txid                TEXT,
  error               TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals (created_at);

CREATE TABLE IF NOT EXISTS binary_contracts (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  asset                   TEXT    NOT NULL DEFAULT 'BTC/USDC',
  direction               TEXT    NOT NULL CHECK (direction IN ('UP', 'DOWN')),
  stake_usd               REAL    NOT NULL,
  payout_ratio            REAL    NOT NULL,
  potential_profit_usd    REAL    NOT NULL,
  total_return_if_win_usd REAL    NOT NULL,
  entry_price             REAL    NOT NULL,
  settlement_price        REAL,
  status                  TEXT    NOT NULL DEFAULT 'OPEN',
  result                  TEXT,
  source                  TEXT    NOT NULL DEFAULT 'MANUAL_BINARY',
  opened_at               TEXT    NOT NULL,
  expires_at              TEXT    NOT NULL,
  settled_at              TEXT,
  market_data_source      TEXT,
  rejection_reason        TEXT,
  notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_binary_contracts_status ON binary_contracts (status);
CREATE INDEX IF NOT EXISTS idx_binary_contracts_expires_at ON binary_contracts (expires_at);

CREATE TABLE IF NOT EXISTS binary_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER,
  event_type  TEXT    NOT NULL,
  message     TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_binary_events_created_at ON binary_events (created_at);

CREATE TABLE IF NOT EXISTS ai_binary_decisions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT    NOT NULL,
  asset               TEXT    NOT NULL DEFAULT 'BTC/USDC',
  signal              TEXT    NOT NULL CHECK (signal IN ('UP', 'DOWN', 'NEUTRAL')),
  confidence          REAL    NOT NULL,
  reason              TEXT,
  features_json       TEXT,
  mode                TEXT    NOT NULL,
  auto_executed       INTEGER NOT NULL DEFAULT 0,
  rejection_reason    TEXT,
  binary_contract_id  INTEGER,
  market_price        REAL,
  updated_at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_binary_decisions_created_at ON ai_binary_decisions (created_at);

CREATE TABLE IF NOT EXISTS ai_binary_stats (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT    NOT NULL,
  stopped_at        TEXT,
  total_signals     INTEGER NOT NULL DEFAULT 0,
  total_trades      INTEGER NOT NULL DEFAULT 0,
  wins              INTEGER NOT NULL DEFAULT 0,
  losses            INTEGER NOT NULL DEFAULT 0,
  refunds           INTEGER NOT NULL DEFAULT 0,
  net_pnl           REAL    NOT NULL DEFAULT 0,
  stop_reason       TEXT
);

CREATE TABLE IF NOT EXISTS ai_binary_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tron_status_checks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at         TEXT NOT NULL,
  mode               TEXT,
  network_name       TEXT,
  connection_status  TEXT,
  ready_to_trade     INTEGER,
  trx_balance        REAL,
  energy_available   REAL,
  bandwidth_available REAL,
  warnings           TEXT
);

CREATE TABLE IF NOT EXISTS binary_session_stats (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_started_at  TEXT NOT NULL,
  session_reset_at    TEXT,
  manual_net_gain     REAL NOT NULL DEFAULT 0,
  ai_net_gain         REAL NOT NULL DEFAULT 0,
  combined_net_gain   REAL NOT NULL DEFAULT 0,
  wins                INTEGER NOT NULL DEFAULT 0,
  losses              INTEGER NOT NULL DEFAULT 0,
  refunds             INTEGER NOT NULL DEFAULT 0,
  gain_limit_reached  INTEGER NOT NULL DEFAULT 0,
  gain_limit_reason   TEXT
);

-- Phase 6.5.1: user-editable settings (DB values override env defaults).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Phase 6.5.1: audit log of every settings/address change.
CREATE TABLE IF NOT EXISTS settings_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tron_fee_deposits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  network        TEXT NOT NULL DEFAULT 'TRON',
  asset          TEXT NOT NULL DEFAULT 'TRX',
  amount_trx     REAL NOT NULL,
  from_address   TEXT,
  txid           TEXT UNIQUE,
  status         TEXT NOT NULL,
  confirmations  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  credited_at    TEXT,
  notes          TEXT
);
`;

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA);

  // Schema drift fix for databases created before `locked_balance` existed.
  if (!hasColumn(db, 'account', 'locked_balance')) {
    db.exec('ALTER TABLE account ADD COLUMN locked_balance REAL NOT NULL DEFAULT 0');
  }

  // Schema drift fixes for databases created before the risk/trading columns existed.
  if (!hasColumn(db, 'account', 'trading_enabled')) {
    db.exec('ALTER TABLE account ADD COLUMN trading_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'account', 'starting_equity')) {
    db.exec('ALTER TABLE account ADD COLUMN starting_equity REAL NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'account', 'post_trade_prompt_enabled')) {
    db.exec('ALTER TABLE account ADD COLUMN post_trade_prompt_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn(db, 'binary_contracts', 'source')) {
    db.exec("ALTER TABLE binary_contracts ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL_BINARY'");
  }
  // Phase 6.4: option expiry/settlement fields.
  if (!hasColumn(db, 'positions', 'duration_seconds')) {
    db.exec('ALTER TABLE positions ADD COLUMN duration_seconds INTEGER');
  }
  if (!hasColumn(db, 'positions', 'expires_at')) {
    db.exec('ALTER TABLE positions ADD COLUMN expires_at TEXT');
  }
  if (!hasColumn(db, 'positions', 'settled_at')) {
    db.exec('ALTER TABLE positions ADD COLUMN settled_at TEXT');
  }
  if (!hasColumn(db, 'positions', 'settlement_price')) {
    db.exec('ALTER TABLE positions ADD COLUMN settlement_price REAL');
  }
  if (!hasColumn(db, 'positions', 'settlement_status')) {
    db.exec('ALTER TABLE positions ADD COLUMN settlement_status TEXT');
  }
  if (!hasColumn(db, 'positions', 'settlement_reason')) {
    db.exec('ALTER TABLE positions ADD COLUMN settlement_reason TEXT');
  }
  if (!hasColumn(db, 'positions', 'source')) {
    db.exec("ALTER TABLE positions ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'");
  }
  // Phase 6.5.1: exact per-position stake + option type.
  if (!hasColumn(db, 'positions', 'stake_usd')) {
    db.exec('ALTER TABLE positions ADD COLUMN stake_usd REAL');
  }
  if (!hasColumn(db, 'positions', 'option_type')) {
    db.exec("ALTER TABLE positions ADD COLUMN option_type TEXT NOT NULL DEFAULT 'CLASSIC'");
  }
  // Phase 6.4: withdrawal fee columns.
  if (!hasColumn(db, 'withdrawals', 'fee_estimate_trx')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_estimate_trx REAL');
  }
  if (!hasColumn(db, 'withdrawals', 'fee_estimate_usd')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_estimate_usd REAL');
  }
  if (!hasColumn(db, 'withdrawals', 'fee_payer')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_payer TEXT');
  }
  if (!hasColumn(db, 'withdrawals', 'fee_status')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_status TEXT');
  }
  if (!hasColumn(db, 'withdrawals', 'fee_notes')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_notes TEXT');
  }
  // Phase 6.4: AI profit-target stats columns.
  if (!hasColumn(db, 'ai_binary_stats', 'profit_target_usd')) {
    db.exec('ALTER TABLE ai_binary_stats ADD COLUMN profit_target_usd REAL');
  }
  if (!hasColumn(db, 'ai_binary_stats', 'daily_profit_limit_percent')) {
    db.exec('ALTER TABLE ai_binary_stats ADD COLUMN daily_profit_limit_percent REAL');
  }
  if (!hasColumn(db, 'ai_binary_stats', 'session_profit_usd')) {
    db.exec('ALTER TABLE ai_binary_stats ADD COLUMN session_profit_usd REAL');
  }
  if (!hasColumn(db, 'ai_binary_stats', 'daily_profit_usd')) {
    db.exec('ALTER TABLE ai_binary_stats ADD COLUMN daily_profit_usd REAL');
  }
  if (!hasColumn(db, 'ai_binary_stats', 'profit_target_reached_at')) {
    db.exec('ALTER TABLE ai_binary_stats ADD COLUMN profit_target_reached_at TEXT');
  }
  if (!hasColumn(db, 'ai_binary_stats', 'stopped_by_profit_target')) {
    db.exec('ALTER TABLE ai_binary_stats ADD COLUMN stopped_by_profit_target INTEGER DEFAULT 0');
  }
  // Phase 6.4: account trade limits + defaults.
  if (!hasColumn(db, 'account', 'max_option_stake_usd')) {
    db.exec('ALTER TABLE account ADD COLUMN max_option_stake_usd REAL NOT NULL DEFAULT 100');
  }
  if (!hasColumn(db, 'account', 'option_default_duration_seconds')) {
    db.exec('ALTER TABLE account ADD COLUMN option_default_duration_seconds INTEGER NOT NULL DEFAULT 300');
  }
  // Phase 6.5: binary session gain limit settings.
  if (!hasColumn(db, 'account', 'binary_session_gain_limit_enabled')) {
    db.exec('ALTER TABLE account ADD COLUMN binary_session_gain_limit_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn(db, 'account', 'binary_max_session_gain_usdc')) {
    db.exec('ALTER TABLE account ADD COLUMN binary_max_session_gain_usdc REAL NOT NULL DEFAULT 50');
  }
  if (!hasColumn(db, 'account', 'binary_max_session_gain_percent')) {
    db.exec('ALTER TABLE account ADD COLUMN binary_max_session_gain_percent REAL NOT NULL DEFAULT 0');
  }
  // Phase 6.5: withdrawal fee reserve fields.
  if (!hasColumn(db, 'withdrawals', 'fee_reserve_sufficient')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_reserve_sufficient INTEGER');
  }
  if (!hasColumn(db, 'withdrawals', 'fee_reserve_error')) {
    db.exec('ALTER TABLE withdrawals ADD COLUMN fee_reserve_error TEXT');
  }

  migrateClassicPositions(db);

  // Schema drift fixes for databases created before the signal-engine columns existed.
  if (!hasColumn(db, 'ai_decisions', 'signal')) {
    db.exec("ALTER TABLE ai_decisions ADD COLUMN signal TEXT NOT NULL DEFAULT 'NEUTRAL'");
  }
  if (!hasColumn(db, 'ai_decisions', 'expected_return')) {
    db.exec('ALTER TABLE ai_decisions ADD COLUMN expected_return REAL NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'ai_decisions', 'proposed_trade_size_usd')) {
    db.exec('ALTER TABLE ai_decisions ADD COLUMN proposed_trade_size_usd REAL NOT NULL DEFAULT 0');
  }

  // Seed the single-row account; INSERT OR IGNORE keeps it idempotent.
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO account (id, created_at, updated_at) VALUES (1, ?, ?)').run(
    now,
    now,
  );

  // Daily loss limit default moved from 5% to 40% (Phase 6.4). Runs AFTER the
  // seed so brand-new databases are covered too; only migrates accounts that
  // still hold the old default so explicit user settings survive.
  db.prepare(
    'UPDATE account SET loss_limit_percent = 40 WHERE loss_limit_percent = 5',
  ).run();

  // Phase 6.5.1 (one-time): the classic default duration moved from 5 to 10
  // minutes. Guarded by a marker so a later explicit 300s choice survives.
  if (!getSettingRaw(db, MIGRATION_6_5_1_MARKER)) {
    db.prepare(
      'UPDATE account SET option_default_duration_seconds = 600 WHERE option_default_duration_seconds = 300',
    ).run();
    db.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    ).run(MIGRATION_6_5_1_MARKER, 'done', new Date().toISOString());
  }

  // Locked balance must equal the sum of open stakes (classic + binary).
  recalculateLockedBalance(db);
}

const MIGRATION_6_5_1_MARKER = 'migration_6_5_1_classic_defaults';

/** ISO-8601 UTC timestamp expression for SQLite (matches toISOString()). */
const ISO = "'%Y-%m-%dT%H:%M:%fZ'";

/**
 * Phase 6.5.1 classic-position fixes. Idempotent, and never alters the
 * outcome fields (status, PnL, settlement) of historical CLOSED positions.
 */
function migrateClassicPositions(db: Database.Database): void {
  // Exact stake for every position that predates the stake_usd column.
  db.prepare(
    'UPDATE positions SET stake_usd = ROUND(entry_premium * quantity, 2) WHERE stake_usd IS NULL',
  ).run();

  // OPEN positions: fixed duration (default 10 minutes) ...
  db.prepare(
    `UPDATE positions SET duration_seconds = 600
     WHERE status = 'OPEN' AND (duration_seconds IS NULL OR duration_seconds <= 0)`,
  ).run();
  // ... expiry = opened_at + duration (opened_at missing/unparseable → now + duration) ...
  db.prepare(
    `UPDATE positions SET expires_at = CASE
        WHEN julianday(opened_at) IS NOT NULL
          THEN strftime(${ISO}, opened_at, '+' || duration_seconds || ' seconds')
        ELSE strftime(${ISO}, 'now', '+' || duration_seconds || ' seconds')
      END
     WHERE status = 'OPEN' AND (expires_at IS NULL OR expires_at = '' OR julianday(expires_at) IS NULL)`,
  ).run();
  // ... legacy 'YYYY-MM-DD HH:MM:SS' expiries (UTC, no zone) → ISO with Z so
  // browsers never misread them as local time ...
  db.prepare(
    `UPDATE positions SET expires_at = strftime(${ISO}, expires_at)
     WHERE status = 'OPEN' AND expires_at NOT LIKE '%T%'`,
  ).run();
  // ... and an explicit OPEN settlement status. A row left in SETTLING can
  // only come from a crash before the (transactional) settlement committed,
  // so it is safe to make it claimable again.
  db.prepare(
    `UPDATE positions SET settlement_status = 'OPEN'
     WHERE status = 'OPEN' AND (settlement_status IS NULL OR settlement_status = 'SETTLING')`,
  ).run();

  // Historical CLOSED positions: display-only expiry backfill when missing.
  db.prepare(
    `UPDATE positions SET expires_at = strftime(${ISO}, opened_at, '+600 seconds')
     WHERE status = 'CLOSED' AND (expires_at IS NULL OR expires_at = '')
       AND julianday(opened_at) IS NOT NULL`,
  ).run();
}

export interface LockedBalanceRepair {
  repaired: boolean;
  previousLocked: number;
  expectedLocked: number;
  /** Positive = funds released back to available cash. */
  releasedToCash: number;
}

/**
 * Recalculates the locked balance from open positions: locked must equal the
 * sum of OPEN classic stakes plus OPEN binary stakes. The difference moves
 * between locked and cash, so total equity is never changed by a repair.
 * Runs inside a transaction; logs a risk event when a repair was needed.
 */
export function recalculateLockedBalance(db: Database.Database): LockedBalanceRepair {
  return db.transaction((): LockedBalanceRepair => {
    const account = db
      .prepare<[], { cash_balance: number; locked_balance: number; equity: number }>(
        'SELECT cash_balance, locked_balance, equity FROM account WHERE id = 1',
      )
      .get();
    if (!account) {
      return { repaired: false, previousLocked: 0, expectedLocked: 0, releasedToCash: 0 };
    }
    const classic =
      db
        .prepare<[], { total: number | null }>(
          "SELECT SUM(COALESCE(stake_usd, ROUND(entry_premium * quantity, 2))) AS total FROM positions WHERE status = 'OPEN'",
        )
        .get()?.total ?? 0;
    const binary =
      db
        .prepare<[], { total: number | null }>(
          "SELECT SUM(stake_usd) AS total FROM binary_contracts WHERE status = 'OPEN'",
        )
        .get()?.total ?? 0;
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const previousLocked = round2(account.locked_balance);
    // Reserving more cash than is available would make cash negative; in
    // that (corrupt-ledger) case reserve only what exists.
    const expectedLocked = round2(
      Math.min(classic + binary, previousLocked + Math.max(0, account.cash_balance)),
    );
    const delta = round2(previousLocked - expectedLocked);
    if (Math.abs(delta) < 0.005) {
      return { repaired: false, previousLocked, expectedLocked, releasedToCash: 0 };
    }
    const nowIso = new Date().toISOString();
    db.prepare(
      'UPDATE account SET locked_balance = ?, cash_balance = ?, updated_at = ? WHERE id = 1',
    ).run(expectedLocked, round2(account.cash_balance + delta), nowIso);
    db.prepare(
      `INSERT INTO risk_events (type, message, equity_at_trigger, triggered_at)
       VALUES ('CLASSIC_LOCKED_BALANCE_REPAIRED', ?, ?, ?)`,
    ).run(
      `locked balance repaired: ${previousLocked} → ${expectedLocked} (sum of open stakes); ` +
        `${delta >= 0 ? 'released' : 'reserved'} ${Math.abs(delta)} ${delta >= 0 ? 'to' : 'from'} available cash`,
      account.equity,
      nowIso,
    );
    return { repaired: true, previousLocked, expectedLocked, releasedToCash: delta };
  })();
}

function getSettingRaw(db: Database.Database, key: string): string | null {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM app_settings WHERE key = ?')
    .get(key);
  return row?.value ?? null;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ReadonlyArray<{ name: string }>;
  return rows.some((row) => row.name === column);
}
