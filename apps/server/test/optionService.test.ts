import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-options-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let OptionService: typeof import('../src/options/optionService.js')['OptionService'];
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

class StubFeed {
  private readonly ticks: PriceTick[] = [];

  push(price: number, timestampIso?: string): void {
    this.ticks.push({
      price,
      timestamp: timestampIso ?? new Date().toISOString(),
      source: 'STUB',
    });
  }

  getLatestTick(): PriceTick | null {
    return this.ticks.at(-1) ?? null;
  }

  getTickAtOrAfter(timestampIso: string): PriceTick | null {
    const target = new Date(timestampIso).getTime();
    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const tick = this.ticks[i]!;
      if (new Date(tick.timestamp).getTime() >= target) {
        return tick;
      }
    }
    return null;
  }
}

let feed: StubFeed;
let service: InstanceType<typeof OptionService>;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  OptionService = (await import('../src/options/optionService.js')).OptionService;
  connection.initDb();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  feed = new StubFeed();
  service = new OptionService(feed);
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: true,
    startingEquity: 500,
    maxOptionStakeUsd: 100,
    optionDefaultDurationSeconds: 600,
  });
  connection.getDb().prepare('DELETE FROM positions').run();
  connection.getDb().prepare('DELETE FROM transactions').run();
});

describe('option service — config and opening', () => {
  it('returns the Phase 6.4 option limits', () => {
    const config = service.getConfig();
    expect(config.maxStakeUsd).toBe(100);
    expect(config.minStakeUsd).toBe(1);
    expect(config.defaultStakeUsd).toBe(10);
    expect(config.allowedDurationsSeconds).toEqual([60, 180, 300, 600, 900, 1800, 3600]);
    expect(config.defaultDurationSeconds).toBe(600);
    expect(config.maxDurationSeconds).toBe(3600);
  });

  it('opens a classic option with an explicit expiry', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDT',
      side: 'CALL',
      stakeUsd: 100,
      durationSeconds: 60,
    });
    expect(position.status).toBe('OPEN');
    expect(position.source).toBe('MANUAL');
    expect(position.durationSeconds).toBe(60);
    expect(new Date(position.expiresAt!).getTime()).toBeGreaterThan(
      new Date(position.openedAt).getTime() + 59_000,
    );
    expect(repo.getAccount().cashBalance).toBe(400);
    expect(repo.getAccount().lockedBalance).toBe(100);
    const transactions = connection
      .getDb()
      .prepare<[], { type: string }>('SELECT type FROM transactions')
      .all();
    expect(transactions.some((t) => t.type === 'OPTION_STAKE_LOCKED')).toBe(true);
  });

  it('rejects stakes above the 100 USDT maximum', () => {
    feed.push(67000);
    expect(() =>
      service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 101, durationSeconds: 60 }),
    ).toThrow('Maximum option stake is 100 USDT.');
  });

  it('rejects unsupported durations', () => {
    feed.push(67000);
    expect(() =>
      service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 90 }),
    ).toThrow('Invalid option duration.');
  });
});


describe('option service — settlement', () => {
  it('settles a winning CALL at expiry with the market price', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDT',
      side: 'CALL',
      stakeUsd: 10,
      durationSeconds: 60,
    });
    connection
      .getDb()
      .prepare<[string, number], unknown>('UPDATE positions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), position.id);
    feed.push(67100);

    service.settleDueOptions();

    const settled = repo.getPositionById(position.id)!;
    expect(settled.status).toBe('CLOSED');
    expect(settled.settlementStatus).toBe('SETTLED');
    expect(settled.settlementPrice).toBe(67100);
    expect(settled.realizedPnl).toBe(8); // 10 * 0.8
    expect(repo.getAccount().lockedBalance).toBe(0);
    expect(repo.getAccount().cashBalance).toBe(508); // 500 - 10 + 10 + 8
  });

  it('settles a losing PUT at expiry', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDT',
      side: 'PUT',
      stakeUsd: 10,
      durationSeconds: 60,
    });
    connection
      .getDb()
      .prepare<[string, number], unknown>('UPDATE positions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), position.id);
    feed.push(67200); // price rose → PUT loses

    service.settleDueOptions();

    const settled = repo.getPositionById(position.id)!;
    expect(settled.settlementStatus).toBe('SETTLED');
    expect(settled.realizedPnl).toBe(-10);
    expect(repo.getAccount().cashBalance).toBe(490);
    expect(repo.getAccount().lockedBalance).toBe(0);
  });

  it('waits within the grace period and refunds when the price stays stale', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDT',
      side: 'CALL',
      stakeUsd: 10,
      durationSeconds: 60,
    });
    connection
      .getDb()
      .prepare<[string, number], unknown>('UPDATE positions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 500).toISOString(), position.id);
    feed.push(67100, new Date(Date.now() - 60_000).toISOString());

    service.settleDueOptions();
    expect(repo.getPositionById(position.id)!.status).toBe('OPEN');

    connection
      .getDb()
      .prepare<[string, number], unknown>('UPDATE positions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 10_000).toISOString(), position.id);
    service.settleDueOptions();

    const refunded = repo.getPositionById(position.id)!;
    expect(refunded.status).toBe('CLOSED');
    expect(refunded.settlementStatus).toBe('REFUNDED');
    expect(repo.getAccount().cashBalance).toBe(500);
    expect(repo.getAccount().lockedBalance).toBe(0);
  });

  it('does not settle positions that are not yet expired', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDT',
      side: 'CALL',
      stakeUsd: 10,
      durationSeconds: 300,
    });
    feed.push(70000);
    service.settleDueOptions();
    expect(repo.getPositionById(position.id)!.status).toBe('OPEN');
  });
});

/* ---------------------------- Phase 6.5.1 ---------------------------------- */

const expire = (id: number): void => {
  connection
    .getDb()
    .prepare<[string, number], unknown>('UPDATE positions SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), id);
};

describe('Phase 6.5.1 — each position locks only its own stake', () => {
  beforeEach(() => {
    repo.updateAccount({ cashBalance: 100, lockedBalance: 0, equity: 100, startingEquity: 100 });
  });

  it('opening a 10 USDT option on a 100 USDT balance locks exactly 10', () => {
    feed.push(67000);
    const position = service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 600 });
    const account = repo.getAccount();
    expect(account.cashBalance).toBe(90);
    expect(account.lockedBalance).toBe(10);
    expect(account.equity).toBe(100); // equity is NOT reduced by locking
    expect(position.stakeUsd).toBe(10);
    const lockRow = connection
      .getDb()
      .prepare("SELECT amount, position_id FROM transactions WHERE type = 'OPTION_STAKE_LOCKED'")
      .get() as { amount: number; position_id: number };
    expect(lockRow).toEqual({ amount: -10, position_id: position.id });
  });

  it('multiple open positions lock exactly the sum of their stakes', () => {
    feed.push(67000);
    for (const stake of [10, 25, 7.5]) {
      service.openOption({ asset: 'BTC/USDT', side: 'PUT', stakeUsd: stake, durationSeconds: 60 });
    }
    const account = repo.getAccount();
    expect(account.lockedBalance).toBe(42.5);
    expect(account.cashBalance).toBe(57.5);
    expect(service.calculateTotalLockedBalance()).toBe(42.5);
    expect(account.cashBalance + account.lockedBalance).toBe(account.equity);
  });

  it('rejects a stake above the available balance with the exact message', () => {
    feed.push(67000);
    repo.updateAccount({ cashBalance: 5, lockedBalance: 95 });
    expect(() =>
      service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 600 }),
    ).toThrow('Insufficient available balance.');
    expect(repo.getAccount().cashBalance).toBe(5); // nothing locked on rejection
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('rejects missing, non-integer, too-short, too-long and non-listed durations', () => {
    feed.push(67000);
    for (const durationSeconds of [Number.NaN, 0, 30, 59.5, 90, 3601, 7200]) {
      expect(() =>
        service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds }),
      ).toThrow('Invalid option duration.');
    }
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('accepts every allowed duration up to 60 minutes and sets expiry = open + duration', () => {
    feed.push(67000);
    for (const durationSeconds of [60, 180, 300, 600, 900, 1800, 3600]) {
      const p = service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 1, durationSeconds });
      expect(new Date(p.expiresAt!).getTime() - new Date(p.openedAt).getTime()).toBe(durationSeconds * 1000);
      expect(p.durationSeconds).toBe(durationSeconds);
      expect(p.settlementStatus).toBe('OPEN');
    }
  });
});

describe('Phase 6.5.1 — settlement releases exactly the stake', () => {
  beforeEach(() => {
    repo.updateAccount({ cashBalance: 100, lockedBalance: 0, equity: 100, startingEquity: 100 });
  });

  it('settlement releases only that position stake; others stay locked', () => {
    feed.push(67000);
    const a = service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 60 });
    service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 20, durationSeconds: 600 });
    expire(a.id);
    feed.push(66000); // CALL loses
    expect(service.settleDueOptions()).toBe(1);
    const account = repo.getAccount();
    expect(account.lockedBalance).toBe(20); // only the 10 was released
    expect(account.cashBalance).toBe(70);
    expect(account.equity).toBe(90);
  });

  it('settlement is idempotent: a position can never be paid twice', () => {
    feed.push(67000);
    const p = service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 60 });
    expect(service.settleExpiredClassicOption(repo.getPositionById(p.id)!, 68000)).toBe(true);
    expect(service.settleExpiredClassicOption(repo.getPositionById(p.id)!, 68000)).toBe(false);
    expect(repo.getAccount()).toMatchObject({ cashBalance: 108, lockedBalance: 0, equity: 108 });
  });

  it('refundAllOpenPositions releases exactly every stake (risk-engine emergency close)', () => {
    feed.push(67000);
    service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 600 });
    service.openOption({ asset: 'BTC/USDT', side: 'PUT', stakeUsd: 15, durationSeconds: 600 });
    expect(service.refundAllOpenPositions('test')).toBe(2);
    expect(repo.getAccount()).toMatchObject({ cashBalance: 100, lockedBalance: 0, equity: 100 });
  });

  it('repairLockedBalance recomputes locked from open stakes without changing equity', () => {
    feed.push(67000);
    service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 600 });
    // Simulate the reported bug: the whole balance shown as locked.
    repo.updateAccount({ cashBalance: 0, lockedBalance: 100 });
    expect(service.repairLockedBalance()).toMatchObject({
      repaired: true,
      previousLocked: 100,
      expectedLocked: 10,
      releasedToCash: 90,
    });
    expect(repo.getAccount()).toMatchObject({ cashBalance: 90, lockedBalance: 10, equity: 100 });
    expect(service.repairLockedBalance().repaired).toBe(false); // second run is a no-op
  });

  it('Stop blocks new opens but existing positions keep settling at expiry', async () => {
    feed.push(67000);
    const p = service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 60 });
    const { getClassicSettingsStore } = await import('../src/options/classicSettings.js');
    getClassicSettingsStore().setClassicFlag(false);
    try {
      expect(() =>
        service.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 60 }),
      ).toThrow(/Classic Options trading is disabled/);
      expire(p.id);
      feed.push(68000);
      expect(service.settleDueOptions()).toBe(1);
      expect(repo.getAccount().lockedBalance).toBe(0);
    } finally {
      getClassicSettingsStore().setClassicFlag(true);
    }
  });
});
