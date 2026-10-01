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
    optionDefaultDurationSeconds: 300,
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
    expect(config.allowedDurationsSeconds).toEqual([60, 180, 300, 600]);
    expect(config.defaultDurationSeconds).toBe(300);
    expect(config.maxDurationSeconds).toBe(600);
  });

  it('opens a classic option with an explicit expiry', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDC',
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

  it('rejects stakes above the 100 USDC maximum', () => {
    feed.push(67000);
    expect(() =>
      service.openOption({ asset: 'BTC/USDC', side: 'CALL', stakeUsd: 101, durationSeconds: 60 }),
    ).toThrow(/exceeds the 100 USDC maximum/);
  });

  it('rejects unsupported durations', () => {
    feed.push(67000);
    expect(() =>
      service.openOption({ asset: 'BTC/USDC', side: 'CALL', stakeUsd: 10, durationSeconds: 90 }),
    ).toThrow(/duration must be one of/);
  });
});


describe('option service — settlement', () => {
  it('settles a winning CALL at expiry with the market price', () => {
    feed.push(67000);
    const position = service.openOption({
      asset: 'BTC/USDC',
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
      asset: 'BTC/USDC',
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
      asset: 'BTC/USDC',
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
      asset: 'BTC/USDC',
      side: 'CALL',
      stakeUsd: 10,
      durationSeconds: 300,
    });
    feed.push(70000);
    service.settleDueOptions();
    expect(repo.getPositionById(position.id)!.status).toBe('OPEN');
  });
});
