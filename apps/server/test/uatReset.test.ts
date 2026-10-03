import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 7: UAT reset — wipes application data, preserves the schema and
 * address configuration, re-seeds a clean account, and refuses unsafe runs.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-uat-reset-test-'));

let connection: typeof import('../src/db/connection.js');
let uatReset: typeof import('../src/admin/uatReset.js');

const DEFAULTS = {
  baseCurrency: 'USDT',
  fixedTradeSizeUsd: 10,
  lossLimitPercent: 40,
  maxOptionStakeUsd: 100,
  optionDefaultDurationSeconds: 600,
};

function opts(overrides: Partial<import('../src/admin/uatReset.js').UatResetOptions> = {}) {
  return {
    mode: 'TESTNET' as const,
    confirm: 'YES',
    allowLive: undefined,
    startingBalanceUsdt: 1000,
    defaults: DEFAULTS,
    ...overrides,
  };
}

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  connection = await import('../src/db/connection.js');
  uatReset = await import('../src/admin/uatReset.js');
  connection.initDb();
});

afterAll(() => {
  connection.closeDb();
  delete process.env['DB_PATH'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('UAT reset safety guards', () => {
  it('refuses without the explicit YES confirmation', () => {
    expect(() => uatReset.runUatReset(connection.getDb(), opts({ confirm: undefined }))).toThrowError(
      uatReset.UatResetError,
    );
    expect(() => uatReset.runUatReset(connection.getDb(), opts({ confirm: 'yes' }))).toThrowError(
      /UAT_RESET_CONFIRM=YES/,
    );
  });

  it('refuses in LIVE mode unless explicitly allowed', () => {
    expect(() =>
      uatReset.runUatReset(connection.getDb(), opts({ mode: 'LIVE' })),
    ).toThrowError(/LIVE/);
    // …and succeeds once the live override is present.
    const result = uatReset.runUatReset(connection.getDb(), opts({ mode: 'LIVE', allowLive: 'true' }));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('LIVE');
  });

  it('refuses implausible starting balances', () => {
    for (const bad of [-1, Number.NaN, 1_000_001]) {
      expect(() =>
        uatReset.runUatReset(connection.getDb(), opts({ startingBalanceUsdt: bad })),
      ).toThrowError(uatReset.UatResetError);
    }
  });
});


describe('UAT reset behaviour', () => {
  it('clears all data, preserves schema + addresses, seeds a clean account', async () => {
    const db = connection.getDb();
    const repo = await import('../src/db/repositories.js');
    const { WalletService } = await import('../src/services/walletService.js');
    const { saveAiBinarySettings } = await import('../src/binary-ai/binaryAiRepository.js');

    const tablesBefore = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name);

    // Seed representative data across the data tables.
    new WalletService().deposit(500, 'seed'); // transactions + account
    repo.createDeposit({ amount: 250, status: 'CONFIRMED', txid: 'tx-seed-1' });
    repo.createTrxFeeDeposit({ amountTrx: 5, status: 'CREDITED', txid: 'trx-seed-1' });
    saveAiBinarySettings({ mode: 'AUTO_EXECUTE' });
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO risk_events (type, message, equity_at_trigger, triggered_at) VALUES ('TEST', 'seed', 500, ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO ai_decisions (symbol, action, confidence, created_at) VALUES ('BTC/USDT', 'HOLD', 0.5, ?)",
    ).run(now);
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('junk_setting', '1', ?)").run(now);
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('usdt_trade_address', 'TAddr', ?)").run(now);
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('migration_6_5_1_classic_defaults', 'done', ?) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(now);

    const result = uatReset.runUatReset(db, opts({ startingBalanceUsdt: 1000 }));
    expect(result.startingBalanceUsdt).toBe(1000);
    expect(result.clearedRows['transactions']).toBeGreaterThan(0);
    expect(result.clearedRows['deposits']).toBeGreaterThan(0);
    expect(result.clearedRows['risk_events']).toBeGreaterThan(0);

    // Schema preserved: identical table set before/after.
    const tablesAfter = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tablesAfter).toEqual(tablesBefore);

    // Data tables empty; account re-seeded clean.
    for (const table of uatReset.UAT_MUST_BE_EMPTY) {
      const n = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`).get()?.n;
      expect(n, table).toBe(0);
    }
    const account = db.prepare('SELECT * FROM account WHERE id = 1').get() as Record<string, unknown>;
    expect(account['cash_balance']).toBe(1000);
    expect(account['equity']).toBe(1000);
    expect(account['locked_balance']).toBe(0);
    expect(account['trading_enabled']).toBe(0);
    expect(account['starting_equity']).toBe(0);
    expect(account['max_open_positions']).toBe(0);
    expect(account['mode']).toBe('TESTNET');

    // Settings: junk gone, addresses + migration markers preserved, safe defaults set.
    const settings = Object.fromEntries(
      db
        .prepare<[], { key: string; value: string }>('SELECT key, value FROM app_settings')
        .all()
        .map((r) => [r.key, r.value]),
    );
    expect(settings['junk_setting']).toBeUndefined();
    expect(settings['usdt_trade_address']).toBe('TAddr');
    expect(settings['migration_6_5_1_classic_defaults']).toBe('done');
    expect(settings['classic_trading_enabled']).toBe('false');
    expect(settings['binary_show_estimated_unrealized_pnl']).toBe('false');
    expect(settings['uat_starting_balance_usdt']).toBe('1000');
    expect(settings['uat_last_reset_at']).toBe(result.resetAt);

    // Post-reset verification passes…
    const verification = uatReset.verifyUatReset(db, 1000);
    expect(verification.problems).toEqual([]);
    expect(verification.ok).toBe(true);

    // …and fails as soon as new data appears.
    repo.createDeposit({ amount: 1, status: 'CONFIRMED', txid: 'tx-after-reset' });
    const dirty = uatReset.verifyUatReset(db, 1000);
    expect(dirty.ok).toBe(false);
    expect(dirty.problems.some((p) => p.includes('deposits'))).toBe(true);
  });

  it('is atomic and repeatable (reset on an empty database is a no-op wipe)', async () => {
    const db = connection.getDb();
    const again = uatReset.runUatReset(db, opts({ startingBalanceUsdt: 0 }));
    expect(again.ok).toBe(true);
    const verification = uatReset.verifyUatReset(db, 0);
    expect(verification.ok).toBe(true);
    expect(verification.account?.['cash_balance']).toBe(0);
  });
});
