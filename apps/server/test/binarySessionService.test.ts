import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-binary-session-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let BinaryService: typeof import('../src/binary/binaryService.js')['BinaryService'];
let AiBinaryService: typeof import('../src/binary-ai/binaryAiService.js')['AiBinaryService'];
let getBinarySessionService: typeof import('../src/binary/binarySessionService.js')['getBinarySessionService'];
let publishEvent: typeof import('../src/events/eventBus.js')['publishEvent'];
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
let aiService: InstanceType<typeof AiBinaryService>;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  process.env['AI_BINARY_ENABLED'] = 'true';
  process.env['AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS'] = '1';
  process.env['AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS'] = '0';
  process.env['AI_BINARY_COOLDOWN_AFTER_LOSS_MS'] = '0';
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  BinaryService = (await import('../src/binary/binaryService.js')).BinaryService;
  AiBinaryService = (await import('../src/binary-ai/binaryAiService.js')).AiBinaryService;
  getBinarySessionService = (await import('../src/binary/binarySessionService.js'))
    .getBinarySessionService;
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
  aiService = new AiBinaryService(feed, binary);
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: true,
    startingEquity: 500,
    binarySessionGainLimitEnabled: true,
    binaryMaxSessionGainUsdt: 50,
    binaryMaxSessionGainPercent: 0,
  });
  connection.getDb().prepare('DELETE FROM binary_contracts').run();
  connection.getDb().prepare('DELETE FROM ai_binary_decisions').run();
  // Rebind the shared session to a fresh row for a clean slate per test.
  getBinarySessionService().resetSession();
});

afterEach(() => {
  aiService.dispose();
});

describe('binary session gain limit', () => {
  it('tracks manual and AI settlement gain separately and combined', () => {
    const session = getBinarySessionService();
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 1, source: 'MANUAL_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 8 },
    });
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 2, source: 'AI_BINARY', result: 'LOSE', stakeUsd: 10, potentialProfitUsd: 8 },
    });

    const stats = session.getStats();
    expect(stats.manualNetGain).toBe(8);
    expect(stats.aiNetGain).toBe(-10);
    expect(stats.combinedNetGain).toBe(-2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.gainLimitReached).toBe(false);
    expect(stats.remainingSessionGain).toBe(52);

  });


  it('blocks new manual binary contracts when the gain limit is reached', () => {
    const session = getBinarySessionService();
    feed.push(67000);
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 3, source: 'MANUAL_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 60 },
    });

    const stats = session.getStats();
    expect(stats.gainLimitReached).toBe(true);
    expect(stats.gainLimitReason).toContain('reached the limit');

    expect(() =>
      binary.openBinaryContract({
        asset: 'BTC/USDT',
        direction: 'UP',
        stakeUsd: 10,
        durationSeconds: 5,
        payoutRatio: 0.8,
      }),
    ).toThrow(/session gain limit/);

    const events = repo
      .listRiskEvents(20)
      .filter((event) => event.type === 'BINARY_SESSION_GAIN_LIMIT_REACHED');
    expect(events.length).toBe(1);

  });

  it('reset session unblocks trading and records an event', () => {
    const session = getBinarySessionService();
    feed.push(67000);
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 4, source: 'MANUAL_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 60 },
    });
    expect(session.isGainLimitReached()).toBe(true);

    const resetStats = session.resetSession();
    expect(resetStats.combinedNetGain).toBe(0);
    expect(resetStats.gainLimitReached).toBe(false);

    const contract = binary.openBinaryContract({
      asset: 'BTC/USDT',
      direction: 'UP',
      stakeUsd: 10,
      durationSeconds: 5,
      payoutRatio: 0.8,
    });
    expect(contract.status).toBe('OPEN');
    expect(
      repo.listRiskEvents(20).some((event) => event.type === 'BINARY_SESSION_RESET'),
    ).toBe(true);

  });

  it('stops AI auto-execution when the binary session gain limit is reached', () => {
    aiService.updateSettings({
      mode: 'AUTO_EXECUTE',
      maxSessionLossUsd: 100,
      profitTargetEnabled: false,
    });
    aiService.start();
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 5, source: 'AI_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 55 },
    });
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      feed.push(100 * (1 + 0.001 * i), new Date(now - (14 - i) * 1000).toISOString());
    }
    aiService.evaluateOnce();

    const status = aiService.getStatus();
    expect(status.running).toBe(false);
    expect(status.warnings.some((w) => w.includes('gain limit'))).toBe(true);
    expect(
      repo
        .listRiskEvents(20)
        .some((event) => event.type === 'AI_BINARY_STOPPED_BY_SESSION_GAIN_LIMIT'),
    ).toBe(true);

  });

  it('validates session gain settings and unblocks when limits are raised', () => {
    const session = getBinarySessionService();
    expect(() => session.updateSettings({ maxSessionGainUsdt: 0 })).toThrow(/positive/);
    expect(() => session.updateSettings({ maxSessionGainPercent: 101 })).toThrow(/between 0 and 100/);

    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 6, source: 'MANUAL_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 60 },
    });
    expect(session.isGainLimitReached()).toBe(true);
    session.updateSettings({ maxSessionGainUsdt: 100 });
    expect(session.isGainLimitReached()).toBe(false);

  });
});
