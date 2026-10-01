import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SimulatedMarketDataService } from '../src/market/marketDataService.js';
import type { MarketDataProvider } from '../src/strategy/signalEngine.js';

let SignalEngine: typeof import('../src/strategy/signalEngine.js')['SignalEngine'];

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

describe('SignalEngine', () => {
  it('emits BULLISH when momentum is positive and volatility is low', () => {
    const closes = [...Array(24).fill(100), 110]; // +10% over 24 candles
    const decision = new SignalEngine(stubMarket(closes, 50)).evaluate('STUB/USDT');
    expect(decision.signal).toBe('BULLISH');
    expect(decision.action).toBe('OPEN_CALL');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5);
    expect(decision.confidence).toBeLessThanOrEqual(0.95);
    expect(decision.expectedReturn).toBeCloseTo(0.1, 6);
    expect(decision.proposedTradeSizeUsd).toBe(10);
  });

  it('emits BEARISH when momentum is negative and volatility is low', () => {
    const closes = [...Array(24).fill(100), 90]; // -10%
    const decision = new SignalEngine(stubMarket(closes, 50)).evaluate('STUB/USDT');
    expect(decision.signal).toBe('BEARISH');
    expect(decision.action).toBe('OPEN_PUT');
    expect(decision.expectedReturn).toBeCloseTo(-0.1, 6);
  });

  it('emits NEUTRAL when volatility is at/above the threshold', () => {
    const closes = [...Array(24).fill(100), 110];
    const decision = new SignalEngine(stubMarket(closes, 200)).evaluate('STUB/USDT');
    expect(decision.signal).toBe('NEUTRAL');
    expect(decision.action).toBe('HOLD');
    expect(decision.confidence).toBe(0.5);
    expect(decision.expectedReturn).toBe(0);
  });

  it('emits NEUTRAL on flat momentum', () => {
    const closes = Array(25).fill(100);
    const decision = new SignalEngine(stubMarket(closes, 50)).evaluate('STUB/USDT');
    expect(decision.signal).toBe('NEUTRAL');
  });

  it('proposed trade size is strictly the configured fixed size', () => {
    const decision = new SignalEngine(stubMarket([...Array(24).fill(100), 130], 50)).evaluate(
      'STUB/USDT',
    );
    expect(decision.proposedTradeSizeUsd).toBe(10);
  });

  it('persists every decision to the database', () => {
    const before = repo.listAiDecisions().length;
    const engine = new SignalEngine(stubMarket([...Array(24).fill(100), 105], 50));
    const decision = engine.evaluate('STUB/USDT');
    const after = repo.listAiDecisions();
    expect(after.length).toBe(before + 1);
    expect(after[0]?.id).toBe(decision.id);
    expect(after[0]?.signal).toBe('BULLISH');
  });

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
