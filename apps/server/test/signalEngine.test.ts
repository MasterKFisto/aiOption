import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SimulatedMarketDataService } from '../src/market/marketDataService.js';
import type { MarketDataProvider } from '../src/strategy/signalEngine.js';

let SignalEngine: typeof import('../src/strategy/signalEngine.js')['SignalEngine'];
let DirectionGuard: typeof import('../src/strategy/directionGuard.js')['DirectionGuard'];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-signal-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  SignalEngine = (await import('../src/strategy/signalEngine.js')).SignalEngine;
  DirectionGuard = (await import('../src/strategy/directionGuard.js')).DirectionGuard;
  connection.initDb();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function candlesFromCloses(closes: number[]): Candle[] {
  const start = Date.now() - (closes.length - 1) * 3_600_000;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      timestamp: start + i * 3_600_000,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 100,
    };
  });
}

/** Crafted market: exact closes + fixed volatility → precise rule testing. */
function stubMarket(closes: number[], annualizedVolPercent: number): MarketDataProvider {
  const candles = candlesFromCloses(closes);
  return {
    getSymbols: () => ['STUB/USDT'],
    getCandles: (_symbol: string, count?: number) => candles.slice(-(count ?? candles.length)),
    getTicker: (symbol: string): Ticker => ({
      symbol,
      lastPrice: 100,
      bid: 99.95,
      ask: 100.05,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      high24h: 100,
      low24h: 100,
      volume24h: 1000,
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

/**
 * Oscillating series with a net drift: alternating up/down moves keep RSI in
 * the normal 30–70 range while momentum points in the drift's direction.
 */
function oscillating(direction: 1 | -1, length = 80): number[] {
  const closes: number[] = [100];
  for (let i = 1; i < length; i++) {
    const up = i % 2 === 1;
    const step = direction === 1 ? (up ? 1 : -0.8) : up ? 0.8 : -1;
    closes.push(closes[i - 1]! + step);
  }
  return closes;
}

/** Monotonic ramp: RSI saturates at 100 (up) / 0 (down). */
const ramp = (direction: 1 | -1, length = 80): number[] =>
  Array.from({ length }, (_, i) => 100 + direction * i * 0.5);

const engineFor = (closes: number[], vol = 50, guard = new DirectionGuard()) =>
  new SignalEngine(stubMarket(closes, vol), { guard });

describe('SignalEngine — momentum + RSI regime filter (Phase 6.5.2)', () => {
  it('emits CALL when momentum is up and RSI is in the normal range', () => {
    const decision = engineFor(oscillating(1)).evaluate('STUB/USDT');
    expect(decision.features!.rsi!).toBeGreaterThan(30);
    expect(decision.features!.rsi!).toBeLessThan(70);
    expect(decision.signal).toBe('BULLISH');
    expect(decision.action).toBe('OPEN_CALL');
    expect(decision.features!.finalSignal).toBe('CALL');
    expect(decision.features!.regime).toBe('NORMAL');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5);
    expect(decision.confidence).toBeLessThanOrEqual(0.95);
    expect(decision.proposedTradeSizeUsd).toBe(10);
  });

  it('emits PUT when momentum is down and RSI is in the normal range', () => {
    const decision = engineFor(oscillating(-1)).evaluate('STUB/USDT');
    expect(decision.signal).toBe('BEARISH');
    expect(decision.action).toBe('OPEN_PUT');
    expect(decision.features!.finalSignal).toBe('PUT');
  });

  it('refuses to open a PUT when RSI < 30 (oversold) → NEUTRAL', () => {
    const decision = engineFor(ramp(-1)).evaluate('STUB/USDT');
    expect(decision.features!.momentumPercent).toBeLessThan(0);
    expect(decision.features!.rawSignal).toBe('BEARISH');
    expect(decision.features!.rsi!).toBeLessThan(30);
    expect(decision.features!.regime).toBe('OVERSOLD');
    expect(decision.signal).toBe('NEUTRAL');
    expect(decision.action).toBe('HOLD');
    expect(decision.features!.filterReason).toMatch(/RSI Oversold/);
    expect(decision.rationale).toMatch(/RSI Oversold/);
  });

  it('refuses to open a CALL when RSI > 70 (overbought) → NEUTRAL', () => {
    const decision = engineFor(ramp(1)).evaluate('STUB/USDT');
    expect(decision.features!.rawSignal).toBe('BULLISH');
    expect(decision.features!.rsi!).toBeGreaterThan(70);
    expect(decision.features!.regime).toBe('OVERBOUGHT');
    expect(decision.signal).toBe('NEUTRAL');
    expect(decision.features!.filterReason).toMatch(/RSI Overbought/);
  });

  it('emits NEUTRAL when volatility is at/above the threshold', () => {
    const decision = engineFor(oscillating(1), 200).evaluate('STUB/USDT');
    expect(decision.signal).toBe('NEUTRAL');
    expect(decision.action).toBe('HOLD');
    expect(decision.confidence).toBe(0.5);
    expect(decision.expectedReturn).toBe(0);
    expect(decision.features!.filterReason).toMatch(/Volatility/);
  });

  it('emits NEUTRAL on flat momentum', () => {
    const decision = engineFor(Array(80).fill(100)).evaluate('STUB/USDT');
    expect(decision.signal).toBe('NEUTRAL');
    expect(decision.features!.rsi).toBe(50);
  });
});

describe('SignalEngine — decision logging, flip guard, live settings (Phase 6.5.2)', () => {
  it('stores the full feature snapshot and merges risk rejection reasons', () => {
    const decision = engineFor(oscillating(1)).evaluate('STUB/USDT');
    const stored = repo.getAiDecisionById(decision.id)!;
    expect(stored.features).toMatchObject({
      currentPrice: expect.any(Number),
      momentumPercent: expect.any(Number),
      rsi: expect.any(Number),
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      volatilityPercent: 50,
      consecutivePutCount: expect.any(Number),
      consecutiveCallCount: expect.any(Number),
      finalSignal: 'CALL',
      rejectionReason: null,
    });
    const rejected = repo.recordAiDecisionRejection(decision.id, 'Max consecutive CALLs reached (3).')!;
    expect(rejected.features!.rejectionReason).toBe('Max consecutive CALLs reached (3).');
    expect(rejected.rationale).toMatch(/Blocked: Max consecutive CALLs/);
  });

  it('requires a NEUTRAL before flipping direction after a trade', () => {
    const guard = new DirectionGuard();
    guard.recordExecution('PUT');
    const flip = engineFor(oscillating(1), 50, guard).evaluate('STUB/USDT');
    expect(flip.signal).toBe('NEUTRAL');
    expect(flip.features!.filterReason).toMatch(/requires a NEUTRAL/);
    const next = engineFor(oscillating(1), 50, guard).evaluate('STUB/USDT');
    expect(next.signal).toBe('BULLISH');
  });

  it('applies saved RSI thresholds immediately (no restart)', async () => {
    const { updateStrategySettings } = await import('../src/strategy/classicStrategySettings.js');
    const rsiNow = engineFor(oscillating(1)).evaluate('STUB/USDT').features!.rsi!;
    updateStrategySettings({ rsiOverbought: Math.max(51, Math.floor(rsiNow) - 1) });
    try {
      const after = engineFor(oscillating(1)).evaluate('STUB/USDT');
      expect(after.signal).toBe('NEUTRAL');
      expect(after.features!.regime).toBe('OVERBOUGHT');
    } finally {
      updateStrategySettings({ rsiOverbought: 70 });
    }
  });

  it('persists every decision to the database', () => {
    const before = repo.listAiDecisions().length;
    const decision = engineFor(oscillating(1)).evaluate('STUB/USDT');
    const after = repo.listAiDecisions();
    expect(after.length).toBe(before + 1);
    expect(after[0]?.id).toBe(decision.id);
  });
});

describe('SignalEngine — real simulated market', () => {
  it('generateAll works with the real simulated market and saves one decision per symbol', () => {
    const before = repo.listAiDecisions().length;
    const engine = new SignalEngine(new SimulatedMarketDataService());
    const decisions = engine.generateAll();
    expect(decisions).toHaveLength(2);
    expect(decisions.map((d) => d.symbol).sort()).toEqual(['BTC/USDT', 'ETH/USDT']);
    for (const d of decisions) {
      expect(d.id).toBeGreaterThan(0);
      expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(d.signal);
      expect(d.proposedTradeSizeUsd).toBe(10);
    }
    expect(repo.listAiDecisions().length).toBe(before + 2);
  });
});
