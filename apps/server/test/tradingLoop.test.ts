import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradingLoop } from '../src/scheduler/tradingLoop.js';
import type { MarketDataProvider } from '../src/strategy/signalEngine.js';

let TradingLoopCtor: typeof TradingLoop;
let OptionServiceCtor: typeof import('../src/options/optionService.js')['OptionService'];
let DirectionGuardCtor: typeof import('../src/strategy/directionGuard.js')['DirectionGuard'];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-loop-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let wallet: InstanceType<typeof import('../src/services/walletService.js')['WalletService']>;

const HOUR = 3_600_000;

/**
 * Oscillating closes with a net drift (up: +60 / −40 per pair, RSI ≈ 60) →
 * CALL; direction −1 mirrors it → PUT. RSI stays in the normal range, so the
 * Phase 6.5.2 overbought/oversold filter does not neutralize the signal.
 */
function trendCloses(direction: 1 | -1 = 1, length = 80): number[] {
  const closes = [66000];
  for (let i = 1; i < length; i++) {
    const up = i % 2 === 1;
    const step = direction === 1 ? (up ? 60 : -40) : up ? 40 : -60;
    closes.push(closes[i - 1]! + step);
  }
  return closes;
}

/** Trend market (CALL by default); adjustable volatility. */
function stubMarket(annualizedVolPercent: number, direction: 1 | -1 = 1): MarketDataProvider {
  const closes = trendCloses(direction);
  const candles: Candle[] = closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      timestamp: Date.now() - (closes.length - 1 - i) * HOUR,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 100,
    };
  });
  return {
    getSymbols: () => ['BTC/USDT'],
    getCandles: (_symbol: string, count?: number) => candles.slice(-(count ?? candles.length)),
    getTicker: (symbol: string): Ticker => ({
      symbol,
      lastPrice: 67000,
      bid: 66966,
      ask: 67034,
      priceChange24h: 1000,
      priceChangePercent24h: 1.5,
      high24h: 67100,
      low24h: 65900,
      volume24h: 5000,
      timestamp: Date.now(),
    }),
    estimateVolatility: (symbol: string, lookbackCandles = 24): VolatilityEstimate => ({
      symbol,
      lookbackCandles,
      perCandlePercent: 0.5,
      annualizedPercent: annualizedVolPercent,
    }),
  };
}

/** Always-fresh BTC price feed so the classic OptionService can open. */
const freshFeed = {
  getLatestTick: () => ({ price: 67000, timestamp: new Date().toISOString(), source: 'STUB' }),
  getTickAtOrAfter: () => null,
};

function makeLoop(
  volPercent: number,
  direction: 1 | -1 = 1,
  guard = new DirectionGuardCtor(),
): TradingLoop {
  return new TradingLoopCtor({
    market: stubMarket(volPercent, direction),
    wallet,
    intervalMs: 60_000,
    options: new OptionServiceCtor(freshFeed),
    guard,
  });
}

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  TradingLoopCtor = (await import('../src/scheduler/tradingLoop.js')).TradingLoop;
  OptionServiceCtor = (await import('../src/options/optionService.js')).OptionService;
  DirectionGuardCtor = (await import('../src/strategy/directionGuard.js')).DirectionGuard;
  const { WalletService } = await import('../src/services/walletService.js');
  connection.initDb();
  wallet = new WalletService();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Close any leftover OPEN positions from previous tests.
  for (const p of repo.listPositions('OPEN')) {
    repo.updatePosition(p.id, { status: 'CLOSED', closedAt: new Date().toISOString() });
  }
  repo.updateAccount({
    cashBalance: 0,
    lockedBalance: 0,
    equity: 0,
    tradingEnabled: false,
    startingEquity: 0,
    maxOpenPositions: 5,
    lossLimitPercent: 5,
    fixedTradeSizeUsd: 10,
  });
});

describe('TradingLoop', () => {
  it('does nothing while trading is disabled in the DB', async () => {
    const loop = makeLoop(50);
    const decisionsBefore = repo.listAiDecisions().length;
    const result = await loop.runOnce();
    expect(result.executed).toHaveLength(0);
    expect(repo.listAiDecisions().length).toBe(decisionsBefore); // no signals generated either
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('executes an approved trade: signal → risk → OptionService → exact stake lock + decision link', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });

    const loop = makeLoop(50);
    const result = await loop.runOnce();

    expect(result.executed).toHaveLength(1);
    const execution = result.executed[0]!;
    expect(execution.symbol).toBe('BTC/USDT');

    // Phase 6.5.1: a short-duration classic option with an explicit expiry.
    const position = repo.getPositionById(execution.positionId)!;
    expect(position.status).toBe('OPEN');
    expect(position.symbol).toMatch(/^BTC-\d{4}-\d{2}-\d{2}-\d+-C$/);
    expect(position.source).toBe('AI');
    expect(position.durationSeconds).toBe(600); // default 10 minutes
    expect(new Date(position.expiresAt!).getTime() - new Date(position.openedAt).getTime()).toBe(600_000);
    expect(position.stakeUsd).toBe(10);

    // decision is marked executed and linked
    const executedDecision = repo.getAiDecisionById(execution.decisionId);
    expect(executedDecision?.executed).toBe(true);
    expect(executedDecision?.positionId).toBe(position.id);

    // wallet: EXACTLY the 10 USDT stake is locked (no fee drift)
    const account = repo.getAccount();
    expect(account.lockedBalance).toBe(10);
    expect(account.cashBalance).toBe(990);
    expect(account.equity).toBe(1000);

    const txs = repo.listTransactions();
    expect(txs[0]?.type).toBe('OPTION_STAKE_LOCKED');
    expect(txs[0]?.amount).toBe(-10);
    expect(txs[0]?.positionId).toBe(position.id);
  });

  it('never opens classic options on non-BTC underlyings (settled against the BTC feed)', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });
    const market = stubMarket(50);
    const ethMarket = { ...market, getSymbols: () => ['ETH/USDT'] };
    const loop = new TradingLoopCtor({
      market: ethMarket,
      wallet,
      intervalMs: 60_000,
      options: new OptionServiceCtor(freshFeed),
    });
    const result = await loop.runOnce();
    expect(result.executed).toHaveLength(0);
    expect(result.skipped.some((s) => /BTC\/USDT only/.test(s.reason))).toBe(true);
    expect(repo.getAccount().lockedBalance).toBe(0);
  });

  it('skips when the open position limit is reached', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000, maxOpenPositions: 1 });

    const loop = makeLoop(50);
    const first = await loop.runOnce();
    expect(first.executed).toHaveLength(1);

    const second = await loop.runOnce();
    expect(second.executed).toHaveLength(0);
    expect(second.skipped.some((s) => /reached the limit/.test(s.reason))).toBe(true);
    expect(repo.listPositions('OPEN')).toHaveLength(1);
  });

  it('skips neutral signals (high volatility)', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });

    const loop = makeLoop(500); // vol above threshold → NEUTRAL
    const result = await loop.runOnce();
    expect(result.executed).toHaveLength(0);
    expect(result.skipped.some((s) => /neutral/.test(s.reason))).toBe(true);
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('halts and disables trading when the loss limit is breached', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000, lossLimitPercent: 5 });
    const loop = makeLoop(50);
    await loop.runOnce(); // open one position

    repo.updateAccount({ equity: 900 }); // 900 <= 950 threshold
    const result = await loop.runOnce();

    expect(result.halted).toBe(true);
    expect(loop.isRunning).toBe(false);
    expect(repo.getAccount().tradingEnabled).toBe(false);
    expect(repo.listPositions('OPEN')).toHaveLength(0);
    expect(repo.listPositions('CLOSED').length).toBeGreaterThan(0);
    // Exactly the 10 USDT stake is released back to cash.
    expect(repo.getAccount().lockedBalance).toBe(0);
    const types = repo.listRiskEvents().map((e) => e.type);
    expect(types.filter((t) => t === 'LOSS_LIMIT_DAILY')).toHaveLength(1);
    expect(types).toContain('CLASSIC_EMERGENCY_REFUND');
  });

  it('Phase 6.5.2: after 3 PUTs the 4th trade is a CALL (rebalance) — trading never stalls', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });
    connection.getDb().prepare("DELETE FROM positions WHERE source = 'AI'").run();
    const guard = new DirectionGuardCtor();
    const putLoop = makeLoop(50, -1, guard); // momentum keeps pointing DOWN

    for (let i = 0; i < 3; i++) {
      const run = await putLoop.runOnce();
      expect(run.executed, `PUT #${i + 1}`).toHaveLength(1);
    }
    expect(guard.streak()).toEqual({ consecutivePutCount: 3, consecutiveCallCount: 0 });

    // 4th tick: a 4th PUT is blocked (risk event logged) and the AI waits one
    // NEUTRAL tick before flipping (neutral cooldown) …
    const fourth = await putLoop.runOnce();
    expect(fourth.executed).toHaveLength(0);
    const event = repo.listRiskEvents().find((e) => e.type === 'CLASSIC_MAX_CONSECUTIVE_DIRECTION');
    expect(event?.message).toMatch(/Max consecutive PUTs reached \(3\)\. Directional bias blocked\./);
    const neutral = repo.listAiDecisions(1)[0]!;
    expect(neutral.features!.finalSignal).toBe('NEUTRAL');
    expect(neutral.features!.filterReason).toMatch(/Max consecutive PUTs reached/);

    // … then rebalances: the next trade is a CALL even though momentum is down.
    const fifth = await putLoop.runOnce();
    expect(fifth.executed).toHaveLength(1);
    expect(repo.getPositionById(fifth.executed[0]!.positionId)!.side).toBe('CALL');
    const rebalanced = repo.listAiDecisions(1)[0]!;
    expect(rebalanced.features!.rawSignal).toBe('BEARISH');
    expect(rebalanced.features!.finalSignal).toBe('CALL');
    expect(rebalanced.features!.rebalanceReason).toMatch(/Rebalanced PUT → CALL/);
    expect(rebalanced.executed).toBe(true);

    // The CALL broke the PUT streak → PUT is allowed again right away (bug
    // fixes: no permanent re-block from history, no CALL/PUT deadlock).
    expect(guard.check('PUT').allowed).toBe(true);
    expect(guard.state().putBlockedUntil).toBeNull();
    expect(guard.streak()).toEqual({ consecutivePutCount: 0, consecutiveCallCount: 1 });
  });

  it('Phase 6.5.2: a blocked direction is allowed again after its cooldown even without trading', async () => {
    connection.getDb().prepare("DELETE FROM positions WHERE source = 'AI'").run();
    let now = Date.now();
    const guard = new DirectionGuardCtor(() => now);
    for (let i = 0; i < 3; i++) {
      repo.createPosition({
        symbol: 'BTC-x-P', side: 'PUT', strikePrice: 1, expiry: '2026-10-03', quantity: 1,
        entryPremium: 10, openedAt: new Date(now - 60_000 + i).toISOString(), source: 'AI',
      });
    }
    expect(guard.check('PUT').allowed).toBe(false); // 3 PUTs → blocked
    now += 6 * 60_000; // cooldown (5 min) elapsed
    // Regression: the same 3 historical PUTs must NOT re-impose the block.
    expect(guard.check('PUT').allowed).toBe(true);
  });

  it('Phase 6.5.2: the max-consecutive limit is read live from saved settings', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });
    connection.getDb().prepare("DELETE FROM positions WHERE source = 'AI'").run();
    const { updateStrategySettings } = await import('../src/strategy/classicStrategySettings.js');
    updateStrategySettings({ maxConsecutiveSameDirection: 1, requireNeutralCooldown: false });
    try {
      const loop = makeLoop(50, 1); // momentum UP
      const first = await loop.runOnce();
      const second = await loop.runOnce();
      expect(repo.getPositionById(first.executed[0]!.positionId)!.side).toBe('CALL');
      // Limit 1 → the next trade is rebalanced to PUT immediately.
      expect(repo.getPositionById(second.executed[0]!.positionId)!.side).toBe('PUT');
    } finally {
      updateStrategySettings({ maxConsecutiveSameDirection: 3, requireNeutralCooldown: true });
    }
  });

  it('Phase 6.5.2: no upper limit on the number of trades (maxOpenPositions = 0)', async () => {
    wallet.deposit(100_000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 100_000, maxOpenPositions: 0 });
    connection.getDb().prepare("DELETE FROM positions WHERE source = 'AI'").run();
    const { updateStrategySettings } = await import('../src/strategy/classicStrategySettings.js');
    updateStrategySettings({ requireNeutralCooldown: false });
    try {
      const loop = makeLoop(50, 1);
      for (let i = 0; i < 30; i++) {
        expect((await loop.runOnce()).executed, `trade #${i + 1}`).toHaveLength(1);
      }
      const open = repo.listPositions('OPEN').filter((p) => p.source === 'AI');
      expect(open).toHaveLength(30); // 30 concurrently open — no cap
      const sides = new Set(open.map((p) => p.side));
      expect(sides).toEqual(new Set(['CALL', 'PUT'])); // both directions
    } finally {
      updateStrategySettings({ requireNeutralCooldown: true });
    }
  });

  it('start and stop toggle the scheduler', () => {
    const loop = makeLoop(50);
    expect(loop.isRunning).toBe(false);
    loop.start();
    expect(loop.isRunning).toBe(true);
    loop.start(); // idempotent
    expect(loop.isRunning).toBe(true);
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });
});
