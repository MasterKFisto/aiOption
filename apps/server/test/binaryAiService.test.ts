import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-binary-ai-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let AiBinaryService: typeof import('../src/binary-ai/binaryAiService.js')['AiBinaryService'];
let BinaryService: typeof import('../src/binary/binaryService.js')['BinaryService'];
let generateAiSignal: typeof import('../src/binary-ai/binaryAiStrategy.js')['generateAiSignal'];
let publishEvent: typeof import('../src/events/eventBus.js')['publishEvent'];
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

/** Controllable feed implementing both the AI and binary tick interfaces. */
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

  getRecentTicks(limit: number): PriceTick[] {
    return this.ticks.slice(-limit);
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
let binary: InstanceType<typeof BinaryService>;
let service: InstanceType<typeof AiBinaryService>;

/** Pushes `count` ticks moving `stepPct`% per second, ending now. */
function pushTrend(target: StubFeed, count: number, stepPct: number): void {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const price = 100 * (1 + (stepPct / 100) * i);
    target.push(price, new Date(now - (count - 1 - i) * 1000).toISOString());
  }
}

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  process.env['AI_BINARY_ENABLED'] = 'true';
  process.env['AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS'] = '1';
  process.env['AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS'] = '0';
  process.env['AI_BINARY_COOLDOWN_AFTER_LOSS_MS'] = '0';
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  AiBinaryService = (await import('../src/binary-ai/binaryAiService.js')).AiBinaryService;
  BinaryService = (await import('../src/binary/binaryService.js')).BinaryService;
  generateAiSignal = (await import('../src/binary-ai/binaryAiStrategy.js')).generateAiSignal;
  publishEvent = (await import('../src/events/eventBus.js')).publishEvent;
  connection.initDb();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  feed = new StubFeed();
  binary = new BinaryService(feed);
  service = new AiBinaryService(feed, binary);
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: true,
    startingEquity: 500,
  });
  connection.getDb().prepare('DELETE FROM binary_contracts').run();
  connection.getDb().prepare('DELETE FROM ai_binary_decisions').run();
});

afterEach(() => {
  service.dispose();
});

describe('AI signal generator', () => {
  it('signals UP on consistent rising momentum', () => {
    const ticks: PriceTick[] = [];
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      ticks.push({
        price: 100 * (1 + 0.001 * i),
        timestamp: new Date(now - (14 - i) * 1000).toISOString(),
        source: 'STUB',
      });
    }
    const result = generateAiSignal(ticks, now, 3000);
    expect(result.signal).toBe('UP');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('signals DOWN on consistent falling momentum', () => {
    const ticks: PriceTick[] = [];
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      ticks.push({
        price: 100 * (1 - 0.001 * i),
        timestamp: new Date(now - (14 - i) * 1000).toISOString(),
        source: 'STUB',
      });
    }
    const result = generateAiSignal(ticks, now, 3000);
    expect(result.signal).toBe('DOWN');
  });

  it('signals NEUTRAL when the market is flat', () => {
    const ticks: PriceTick[] = [];
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      ticks.push({
        price: 100,
        timestamp: new Date(now - (14 - i) * 1000).toISOString(),
        source: 'STUB',
      });
    }
    const result = generateAiSignal(ticks, now, 3000);
    expect(result.signal).toBe('NEUTRAL');
  });

  it('signals NEUTRAL on stale data', () => {
    const ticks: PriceTick[] = [];
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      ticks.push({
        price: 100 * (1 + 0.001 * i),
        timestamp: new Date(now - 60_000 - (14 - i) * 1000).toISOString(),
        source: 'STUB',
      });
    }
    const result = generateAiSignal(ticks, now, 3000);
    expect(result.signal).toBe('NEUTRAL');
    expect(result.reason).toContain('stale');
  });
});


describe('AI binary service — SIGNAL_ONLY', () => {
  it('stores signals without opening contracts', () => {
    const status = service.updateSettings({ mode: 'SIGNAL_ONLY' });
    expect(status.mode).toBe('SIGNAL_ONLY');
    service.start();
    pushTrend(feed, 15, 0.1);
    service.evaluateOnce();

    const decisions = service.getDecisions(10);
    expect(decisions.length).toBe(1);
    expect(decisions[0]!.signal).toBe('UP');
    expect(decisions[0]!.autoExecuted).toBe(false);
    expect(
      connection
        .getDb()
        .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM binary_contracts')
        .get()?.count,
    ).toBe(0);

    const statusAfter = service.getStatus();
    expect(statusAfter.running).toBe(true);
    expect(statusAfter.currentSignal).toBe('UP');
    expect(statusAfter.sessionStats.totalSignals).toBe(1);
    expect(statusAfter.sessionStats.totalTrades).toBe(0);
  });

  it('refuses to start when mode is DISABLED', () => {
    service.updateSettings({ mode: 'DISABLED' });
    expect(() => service.start()).toThrow(/DISABLED/);
  });
});

describe('AI binary service — AUTO_EXECUTE', () => {
  it('opens binary contracts with source AI_BINARY after checks pass', () => {
    service.updateSettings({ mode: 'AUTO_EXECUTE', stakeUsd: 10, durationSeconds: 5 });
    service.start();
    pushTrend(feed, 15, 0.1);
    service.evaluateOnce();

    const contracts = connection
      .getDb()
      .prepare<[], { id: number; source: string; stake_usd: number }>(
        'SELECT id, source, stake_usd FROM binary_contracts',
      )
      .all();
    expect(contracts.length).toBe(1);
    expect(contracts[0]!.source).toBe('AI_BINARY');
    expect(contracts[0]!.stake_usd).toBe(10);

    const decisions = service.getDecisions(10);
    expect(decisions[0]!.autoExecuted).toBe(true);
    expect(decisions[0]!.binaryContractId).toBe(contracts[0]!.id);

    const status = service.getStatus();
    expect(status.sessionStats.totalTrades).toBe(1);
    expect(status.openContracts).toBe(1);

    // Ledger uses the AI transaction type.
    const ledger = connection
      .getDb()
      .prepare<[], { type: string }>('SELECT type FROM transactions ORDER BY id DESC LIMIT 1')
      .get();
    expect(ledger?.type).toBe('AI_BINARY_STAKE_LOCKED');
  });

  it('does not trade when confidence is below the minimum', () => {
    service.updateSettings({
      mode: 'AUTO_EXECUTE',
      minConfidence: 0.99,
      stakeUsd: 10,
    });
    service.start();
    pushTrend(feed, 15, 0.05); // weak momentum → low confidence
    service.evaluateOnce();

    const decisions = service.getDecisions(10);
    expect(decisions[0]!.autoExecuted).toBe(false);
    expect(
      connection
        .getDb()
        .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM binary_contracts')
        .get()?.count,
    ).toBe(0);
  });

  it('stops after maximum consecutive losses', () => {
    service.updateSettings({ mode: 'AUTO_EXECUTE', maxSessionLossUsd: 100 });
    service.start();
    for (let i = 0; i < 3; i++) {
      publishEvent('binary', {
        action: 'SETTLED',
        contract: {
          id: 100 + i,
          source: 'AI_BINARY',
          result: 'LOSE',
          stakeUsd: 10,
          potentialProfitUsd: 8,
        },
      });
    }
    const status = service.getStatus();
    expect(status.running).toBe(false);
    expect(status.sessionStats.consecutiveLosses).toBe(3);
    expect(status.warnings.some((w) => w.includes('consecutive losses'))).toBe(true);
  });

  it('stops when session loss reaches the limit', () => {
    service.updateSettings({ mode: 'AUTO_EXECUTE', maxSessionLossUsd: 15 });
    service.start();
    for (const id of [200, 201]) {
      publishEvent('binary', {
        action: 'SETTLED',
        contract: { id, source: 'AI_BINARY', result: 'LOSE', stakeUsd: 10, potentialProfitUsd: 8 },
      });
    }
    const status = service.getStatus();
    expect(status.running).toBe(false);
    expect(status.sessionStats.sessionLossUsd).toBe(20);
    expect(status.warnings.some((w) => w.includes('session loss'))).toBe(true);
  });

  it('ignores manual binary settlements in AI stats', () => {
    service.updateSettings({ mode: 'AUTO_EXECUTE' });
    service.start();
    publishEvent('binary', {
      action: 'SETTLED',
      contract: {
        id: 300,
        source: 'MANUAL_BINARY',
        result: 'LOSE',
        stakeUsd: 10,
        potentialProfitUsd: 8,
      },
    });
    const status = service.getStatus();
    expect(status.sessionStats.losses).toBe(0);
    expect(status.running).toBe(true);
  });

  it('warns and blocks on stale market data', () => {
    service.updateSettings({ mode: 'AUTO_EXECUTE' });
    service.start();
    service.dispose();
    const staleFeed = new StubFeed();
    for (let i = 0; i < 15; i++) {
      staleFeed.push(
        100 * (1 + 0.001 * i),
        new Date(Date.now() - 60_000 + i * 1000).toISOString(),
      );
    }
    service = new AiBinaryService(staleFeed, new BinaryService(staleFeed));
    service.updateSettings({ mode: 'AUTO_EXECUTE' });
    service.start();
    service.evaluateOnce();

    const status = service.getStatus();
    expect(status.sessionStats.totalSignals).toBe(0);
    expect(status.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  it('validates settings updates', () => {
    expect(() => service.updateSettings({ mode: 'BOGUS' as never })).toThrow(/invalid mode/);
    expect(() => service.updateSettings({ durationSeconds: 7 })).toThrow(/durationSeconds/);
    expect(() => service.updateSettings({ payoutRatio: 0.33 })).toThrow(/payoutRatio/);
    expect(() => service.updateSettings({ minConfidence: 1.5 })).toThrow(/minConfidence/);
    expect(() => service.updateSettings({ stakeUsd: 0 })).toThrow(/stakeUsd/);
  });


});
describe('AI binary service — safety fixes (regression)', () => {
  it('logs the stale-data risk event once, not once per evaluation', () => {
    connection.getDb().prepare('DELETE FROM risk_events').run();
    service.updateSettings({ mode: 'AUTO_EXECUTE' });
    service.start();
    service.dispose();
    const staleFeed = new StubFeed();
    for (let i = 0; i < 15; i++) {
      staleFeed.push(
        100 * (1 + 0.001 * i),
        new Date(Date.now() - 60_000 + i * 1000).toISOString(),
      );
    }
    service = new AiBinaryService(staleFeed, new BinaryService(staleFeed));
    service.updateSettings({ mode: 'AUTO_EXECUTE' });
    service.start();
    service.evaluateOnce();
    service.evaluateOnce();
    service.evaluateOnce();

    const staleEvents = repo
      .listRiskEvents(50)
      .filter((event) => event.type === 'AI_BINARY_MARKET_DATA_STALE');
    expect(staleEvents.length).toBe(1);
  });

  it('persists the rejection reason on non-executed decisions', () => {
    service.updateSettings({ mode: 'AUTO_EXECUTE', minConfidence: 0.99, maxSessionLossUsd: 100 });
    service.start();
    pushTrend(feed, 15, 0.05);
    service.evaluateOnce();

    const decisions = service.getDecisions(10);
    expect(decisions[0]!.autoExecuted).toBe(false);
    expect(decisions[0]!.rejectionReason).toContain('below minimum');
  });

  it('stops the engine when the mode is switched to DISABLED', () => {
    service.updateSettings({ mode: 'SIGNAL_ONLY' });
    service.start();
    expect(service.getStatus().running).toBe(true);

    service.updateSettings({ mode: 'DISABLED' });
    const status = service.getStatus();
    expect(status.mode).toBe('DISABLED');
    expect(status.running).toBe(false);
  });

  it('bounds the stake by the Phase 6.2 min/max stake', () => {
    expect(() => service.updateSettings({ stakeUsd: 100 })).toThrow(/stakeUsd must be between/);
    expect(() => service.updateSettings({ stakeUsd: 0.5 })).toThrow(/stakeUsd must be between/);
  });

  it('exposes the configured limits in the status', () => {
    service.updateSettings({ minConfidence: 0.7, maxOpenContracts: 2, maxSessionLossUsd: 40 });
    const status = service.getStatus();
    expect(status.minConfidence).toBe(0.7);
    expect(status.maxOpenContracts).toBe(2);
    expect(status.maxSessionLossUsd).toBe(40);
  });
});

describe('AI binary service — profit target (Phase 6.4)', () => {
  it('stops when the session profit reaches the target', () => {
    service.updateSettings({
      mode: 'AUTO_EXECUTE',
      maxSessionLossUsd: 100,
      profitTargetEnabled: true,
      profitTargetUsd: 10,
      stopOnProfitTarget: true,
    });
    service.start();
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 500, source: 'AI_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 12 },
    });

    const status = service.getStatus();
    expect(status.running).toBe(false);
    expect(status.stoppedByProfitTarget).toBe(true);
    expect(status.sessionProfitUsd).toBe(12);
    expect(status.sessionStats.sessionProfitUsd).toBe(12);
    expect(status.warnings.some((w) => w.includes('profit target'))).toBe(true);

    const events = repo
      .listRiskEvents(20)
      .filter(
        (event) =>
          event.type === 'AI_BINARY_STOPPED_BY_PROFIT_TARGET' ||
          event.type === 'AI_BINARY_PROFIT_TARGET_REACHED',
      );
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('stops when the daily profit limit is reached', () => {
    service.updateSettings({
      mode: 'AUTO_EXECUTE',
      maxSessionLossUsd: 100,
      profitTargetEnabled: true,
      profitTargetUsd: 999,
      dailyProfitLimitPercent: 2, // 2% of 500 starting equity = 10
      stopOnProfitTarget: true,
    });
    service.start();
    // Seed settled AI wins earlier today (they count toward the daily limit).
    const nowIso = new Date().toISOString();
    connection
      .getDb()
      .prepare(
        `INSERT INTO binary_contracts
           (asset, direction, stake_usd, payout_ratio, potential_profit_usd, total_return_if_win_usd,
            entry_price, status, source, result, opened_at, expires_at, settled_at, settlement_price)
         VALUES ('BTC/USDT', 'UP', 10, 0.8, 6, 18, 100, 'SETTLED', 'AI_BINARY', 'WIN',
                 ?, ?, ?, 101)`,
      )
      .run(nowIso, nowIso, nowIso);
    connection
      .getDb()
      .prepare(
        `INSERT INTO binary_contracts
           (asset, direction, stake_usd, payout_ratio, potential_profit_usd, total_return_if_win_usd,
            entry_price, status, source, result, opened_at, expires_at, settled_at, settlement_price)
         VALUES ('BTC/USDT', 'UP', 10, 0.8, 6, 18, 100, 'SETTLED', 'AI_BINARY', 'WIN',
                 ?, ?, ?, 101)`,
      )
      .run(nowIso, nowIso, nowIso);
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 600, source: 'AI_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 6 },
    });

    const status = service.getStatus();
    expect(status.running).toBe(false);
    expect(status.stoppedByProfitTarget).toBe(true);
    expect(status.dailyProfitUsd).toBe(12);
    expect(status.sessionStats.dailyProfitUsd).toBe(12);
    expect(
      repo
        .listRiskEvents(20)
        .some((event) => event.type === 'AI_BINARY_DAILY_PROFIT_LIMIT_REACHED'),
    ).toBe(true);
  });

  it('keeps running when the profit target is disabled', () => {
    service.updateSettings({
      mode: 'AUTO_EXECUTE',
      maxSessionLossUsd: 100,
      profitTargetEnabled: false,
      profitTargetUsd: 10,
    });
    service.start();
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 700, source: 'AI_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 12 },
    });
    const status = service.getStatus();
    expect(status.running).toBe(true);
    expect(status.stoppedByProfitTarget).toBe(false);
  });

  it('validates profit target settings', () => {
    expect(() => service.updateSettings({ profitTargetUsd: 0 })).toThrow(/profitTargetUsd/);
    expect(() => service.updateSettings({ dailyProfitLimitPercent: 101 })).toThrow(
      /dailyProfitLimitPercent/,
    );
  });
});

