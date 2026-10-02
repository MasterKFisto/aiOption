import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-migrations-test-'));
const dbPath = path.join(tmpDir, 'legacy.db');

let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');

/** Creates a DB with the pre-Phase-4/5 schema (no new columns at all). */
function createLegacyDb(): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'PAPER',
      equity REAL NOT NULL DEFAULT 0,
      cash_balance REAL NOT NULL DEFAULT 0,
      base_currency TEXT NOT NULL DEFAULT 'USD',
      fixed_trade_size_usd REAL NOT NULL DEFAULT 100,
      max_open_positions INTEGER NOT NULL DEFAULT 5,
      loss_limit_percent REAL NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      confidence REAL NOT NULL,
      rationale TEXT,
      executed INTEGER NOT NULL DEFAULT 0,
      position_id INTEGER,
      created_at TEXT NOT NULL
    );
    INSERT INTO account (id, equity, cash_balance, created_at, updated_at)
      VALUES (1, 500, 500, 'legacy', 'legacy');
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('CALL', 'PUT')),
      strike_price REAL NOT NULL,
      expiry TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_premium REAL NOT NULL,
      exit_premium REAL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
      realized_pnl REAL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      created_at TEXT NOT NULL
    );
    -- Legacy OPEN position without any expiry timestamp: the migration must
    -- backfill expires_at = opened_at + 10 minutes.
    INSERT INTO positions (symbol, side, strike_price, expiry, quantity, entry_premium, status, opened_at, created_at)
      VALUES ('BTC-2026-10-08-67000-C', 'CALL', 67000, '2026-10-08', 1, 10, 'OPEN', '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z');
  `);
  db.close();
}

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  createLegacyDb();
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  connection.initDb(); // runs migrations incl. ALTER TABLE drift fixes
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrations on a legacy schema', () => {
  it('adds the missing account columns via ALTER TABLE', () => {
    const cols = connection
      .getDb()
      .prepare('PRAGMA table_info(account)')
      .all() as ReadonlyArray<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['locked_balance', 'trading_enabled', 'starting_equity']),
    );
  });

  it('adds the missing ai_decisions columns via ALTER TABLE', () => {
    const cols = connection
      .getDb()
      .prepare('PRAGMA table_info(ai_decisions)')
      .all() as ReadonlyArray<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['signal', 'expected_return', 'proposed_trade_size_usd']),
    );
  });

  it('preserves legacy data and applies sane defaults for new columns', () => {
    const account = repo.getAccount();
    expect(account.equity).toBe(500);
    expect(account.cashBalance).toBe(500);
    expect(account.lockedBalance).toBe(0);
    expect(account.tradingEnabled).toBe(false);
    expect(account.startingEquity).toBe(0);
    // Phase 6.4 defaults + 6.5 gain-limit settings.
    expect(account.maxOptionStakeUsd).toBe(100);
    expect(account.optionDefaultDurationSeconds).toBe(300);
    expect(account.binarySessionGainLimitEnabled).toBe(true);
    expect(account.binaryMaxSessionGainUsdc).toBe(50);
    expect(account.binaryMaxSessionGainPercent).toBe(0);
    // Daily loss limit default migrated from the old 5% to 40%.
    expect(account.lossLimitPercent).toBe(40);
  });

  it('creates the Phase 6.5 tables', () => {
    const tables = connection
      .getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as ReadonlyArray<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'binary_session_stats',
        'tron_fee_deposits',
        'tron_status_checks',
        'binary_contracts',
        'ai_binary_decisions',
        'ai_binary_stats',
        'ai_binary_settings',
      ]),
    );
  });

  it('adds the Phase 6.4/6.5 columns to positions and withdrawals', () => {
    const positionCols = connection
      .getDb()
      .prepare('PRAGMA table_info(positions)')
      .all() as ReadonlyArray<{ name: string }>;
    const positionNames = positionCols.map((c) => c.name);
    expect(positionNames).toEqual(
      expect.arrayContaining([
        'duration_seconds',
        'expires_at',
        'settled_at',
        'settlement_price',
        'settlement_status',
        'settlement_reason',
        'source',
      ]),
    );

    const withdrawalCols = connection
      .getDb()
      .prepare('PRAGMA table_info(withdrawals)')
      .all() as ReadonlyArray<{ name: string }>;
    const withdrawalNames = withdrawalCols.map((c) => c.name);
    expect(withdrawalNames).toEqual(
      expect.arrayContaining([
        'fee_estimate_trx',
        'fee_estimate_usd',
        'fee_payer',
        'fee_status',
        'fee_notes',
        'fee_reserve_sufficient',
        'fee_reserve_error',
      ]),
    );
  });

  it('backfills expires_at for legacy OPEN positions (opened_at + 10 minutes)', () => {
    const position = repo.listPositions('OPEN')[0];
    expect(position).toBeDefined();
    // SQLite datetime() renders 'YYYY-MM-DD HH:MM:SS'.
    expect(position!.expiresAt).toBe('2026-10-01 08:10:00');
    expect(position!.status).toBe('OPEN');
  });
});
