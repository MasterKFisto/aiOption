import type Database from 'better-sqlite3';

/**
 * Phase 7 — UAT reset (shared by the CLI script and the optional admin API).
 *
 * Clears every APPLICATION DATA table, keeps the schema (tables, indexes,
 * columns) intact, re-seeds a single clean account row with the configured
 * starting balance and restores safe app_settings defaults.
 *
 * SAFETY:
 *  - requires an explicit confirmation (UAT_RESET_CONFIRM=YES),
 *  - refuses to run when MODE=LIVE unless UAT_RESET_ALLOW_LIVE=true,
 *  - runs in ONE transaction (all-or-nothing),
 *  - never deletes the database file (back up first — see docs).
 */

/** Tables whose rows are wiped (children before parents for foreign keys). */
export const UAT_DATA_TABLES = [
  'transactions',
  'ai_decisions',
  'positions',
  'risk_events',
  'deposits',
  'withdrawals',
  'binary_events',
  'binary_contracts',
  'ai_binary_decisions',
  'ai_binary_stats',
  'ai_binary_settings',
  'tron_status_checks',
  'binary_session_stats',
  'settings_audit',
  'tron_fee_deposits',
] as const;

/** Tables that must be EMPTY after a reset (verification list). */
export const UAT_MUST_BE_EMPTY = [
  'positions',
  'transactions',
  'deposits',
  'withdrawals',
  'binary_contracts',
  'binary_events',
  'ai_decisions',
  'ai_binary_decisions',
  'risk_events',
  'tron_fee_deposits',
] as const;

/**
 * app_settings keys preserved across a reset. Wallet ADDRESSES are
 * configuration (not trading data) and migration markers must survive so
 * one-time migrations never re-run. Everything else returns to defaults.
 */
export const UAT_PRESERVED_SETTINGS = [
  'usdc_trade_address',
  'withdrawal_destination_address',
  'trx_fee_wallet_address',
  'migration_6_5_1_classic_defaults',
  'migration_6_5_2_unlimited_trades',
] as const;

/** Safe defaults written after the reset (trading OFF, conservative display). */
export const UAT_SAFE_SETTINGS: Readonly<Record<string, string>> = {
  classic_trading_enabled: 'false',
  binary_show_estimated_unrealized_pnl: 'false',
};

export interface UatResetOptions {
  /** Effective application mode (config.MODE). */
  mode: 'PAPER' | 'TESTNET' | 'LIVE';
  /** Must be exactly "YES". */
  confirm: string | undefined;
  /** Must be "true" to reset in LIVE mode. */
  allowLive: string | undefined;
  /** Starting USDC balance for the clean account (0 … 1,000,000). */
  startingBalanceUsdc: number;
  /** Account defaults (from config) for the re-seeded row. */
  defaults: {
    baseCurrency: string;
    fixedTradeSizeUsd: number;
    lossLimitPercent: number;
    maxOptionStakeUsd: number;
    optionDefaultDurationSeconds: number;
  };
}

export interface UatResetResult {
  ok: true;
  mode: string;
  startingBalanceUsdc: number;
  clearedRows: Record<string, number>;
  resetAt: string;
}

export class UatResetError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_CONFIRMED' | 'LIVE_MODE_BLOCKED' | 'INVALID_BALANCE',
  ) {
    super(message);
    this.name = 'UatResetError';
  }
}

/** Validates the safety preconditions; throws UatResetError when unsafe. */
export function assertUatResetAllowed(options: UatResetOptions): void {
  if (options.confirm !== 'YES') {
    throw new UatResetError(
      'UAT reset not confirmed: set UAT_RESET_CONFIRM=YES to wipe all application data',
      'NOT_CONFIRMED',
    );
  }
  if (options.mode === 'LIVE' && options.allowLive !== 'true') {
    throw new UatResetError(
      'UAT reset refused: MODE=LIVE. Set UAT_RESET_ALLOW_LIVE=true only if you really intend to wipe a live database',
      'LIVE_MODE_BLOCKED',
    );
  }
  const b = options.startingBalanceUsdc;
  if (!Number.isFinite(b) || b < 0 || b > 1_000_000) {
    throw new UatResetError(
      'UAT_RESET_STARTING_BALANCE_USDC must be a number between 0 and 1000000',
      'INVALID_BALANCE',
    );
  }
}

export function tableExists(db: Database.Database, table: string): boolean {
  return (
    db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table)?.n === 1
  );
}

/** Identifiers come only from the hard-coded lists above; validated anyway. */
export function ident(table: string): string {
  if (!/^[a-z_]+$/.test(table)) {
    throw new Error(`invalid table name: ${table}`);
  }
  return table;
}

/**
 * Performs the reset on an already-migrated database. Atomic. The caller is
 * responsible for running migrations first (schema present) and for stopping
 * background loops when the server is running.
 */
export function runUatReset(db: Database.Database, options: UatResetOptions): UatResetResult {
  assertUatResetAllowed(options);
  const resetAt = new Date().toISOString();
  const balance = Math.round(options.startingBalanceUsdc * 100) / 100;
  const clearedRows: Record<string, number> = {};

  db.transaction(() => {
    for (const table of UAT_DATA_TABLES) {
      if (tableExists(db, table)) {
        clearedRows[table] = db.prepare(`DELETE FROM ${ident(table)}`).run().changes;
      }
    }
    // Restart AUTOINCREMENT ids so the first record after reset is #1.
    if (tableExists(db, 'sqlite_sequence')) {
      db.prepare('DELETE FROM sqlite_sequence').run();
    }

    // app_settings: keep addresses + migration markers, reset the rest.
    const placeholders = UAT_PRESERVED_SETTINGS.map(() => '?').join(', ');
    clearedRows['app_settings'] = db
      .prepare(`DELETE FROM app_settings WHERE key NOT IN (${placeholders})`)
      .run(...UAT_PRESERVED_SETTINGS).changes;
    const upsert = db.prepare<[string, string, string], unknown>(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    );
    for (const [key, value] of Object.entries(UAT_SAFE_SETTINGS)) {
      upsert.run(key, value, resetAt);
    }
    upsert.run('uat_last_reset_at', resetAt, resetAt);
    upsert.run('uat_starting_balance_usdc', String(balance), resetAt);

    // Re-seed the single account row: trading OFF, nothing locked.
    db.prepare('DELETE FROM account').run();
    db.prepare(
      `INSERT INTO account (id, mode, equity, cash_balance, locked_balance, base_currency,
         fixed_trade_size_usd, max_open_positions, loss_limit_percent, trading_enabled,
         starting_equity, created_at, updated_at)
       VALUES (1, ?, ?, ?, 0, ?, ?, 0, ?, 0, 0, ?, ?)`,
    ).run(
      options.mode,
      balance,
      balance,
      options.defaults.baseCurrency,
      options.defaults.fixedTradeSizeUsd,
      options.defaults.lossLimitPercent,
      resetAt,
      resetAt,
    );
    db.prepare(
      'UPDATE account SET max_option_stake_usd = ?, option_default_duration_seconds = ? WHERE id = 1',
    ).run(options.defaults.maxOptionStakeUsd, options.defaults.optionDefaultDurationSeconds);
  })();

  return { ok: true, mode: options.mode, startingBalanceUsdc: balance, clearedRows, resetAt };
}

export interface UatVerification {
  ok: boolean;
  problems: string[];
  counts: Record<string, number>;
  account: Record<string, unknown> | null;
  settings: Record<string, string>;
}

/** Read-only verification of a clean post-reset state. */
export function verifyUatReset(db: Database.Database, expectedBalance?: number): UatVerification {
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  for (const table of [...UAT_MUST_BE_EMPTY, 'account', 'app_settings']) {
    if (!tableExists(db, table)) {
      problems.push(`table ${table} is missing (schema not preserved)`);
      continue;
    }
    counts[table] =
      db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${ident(table)}`).get()?.n ?? -1;
  }
  for (const table of UAT_MUST_BE_EMPTY) {
    if ((counts[table] ?? 0) !== 0) {
      problems.push(`${table} has ${counts[table]} rows (expected 0)`);
    }
  }
  if (counts['account'] !== 1) {
    problems.push(`account has ${counts['account'] ?? 0} rows (expected exactly 1)`);
  }
  const account = tableExists(db, 'account')
    ? ((db.prepare('SELECT * FROM account WHERE id = 1').get() as Record<string, unknown> | undefined) ?? null)
    : null;
  if (account) {
    if (account['trading_enabled'] !== 0) {
      problems.push('account.trading_enabled must be 0 after reset');
    }
    if (account['locked_balance'] !== 0) {
      problems.push('account.locked_balance must be 0 after reset');
    }
    if (expectedBalance !== undefined && account['cash_balance'] !== expectedBalance) {
      problems.push(`account.cash_balance is ${String(account['cash_balance'])} (expected ${expectedBalance})`);
    }
    if (account['equity'] !== account['cash_balance']) {
      problems.push('account.equity must equal cash_balance after reset');
    }
  }
  const settings: Record<string, string> = {};
  if (tableExists(db, 'app_settings')) {
    for (const row of db
      .prepare<[], { key: string; value: string }>('SELECT key, value FROM app_settings')
      .all()) {
      settings[row.key] = row.value;
    }
  }
  for (const [key, value] of Object.entries(UAT_SAFE_SETTINGS)) {
    if (settings[key] !== value) {
      problems.push(`app_settings.${key} is ${settings[key] ?? '(missing)'} (expected ${value})`);
    }
  }
  return { ok: problems.length === 0, problems, counts, account, settings };
}

