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
  });
});
