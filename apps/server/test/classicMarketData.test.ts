import type { Candle, PriceTick } from '@aioption/shared';
import { describe, expect, it } from 'vitest';

import { ClassicMarketData } from '../src/market/classicMarketData.js';
import type { MarketDataProvider } from '../src/strategy/signalEngine.js';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

function liveCandles(count: number, lastTs = NOW - 60_000): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 60_000 + Math.sin(i / 3) * 100;
    return {
      timestamp: lastTs - (count - 1 - i) * 300_000,
      open: close - 5,
      high: close + 10,
      low: close - 10,
      close,
      volume: 1,
    };
  });
}

function feed(candles: Candle[] | Error, tick: PriceTick | null) {
  return {
    getCandles: async () => {
      if (candles instanceof Error) throw candles;
      return candles;
    },
    getLatestTick: () => tick,
  };
}

const fallback: MarketDataProvider = {
  getSymbols: () => ['BTC/USDT'],
  getCandles: (_s, count = 10) => liveCandles(count).map((c) => ({ ...c, close: 1 })),
  getTicker: () => ({}) as never,
  estimateVolatility: (symbol, lookbackCandles = 24) => ({
    symbol,
    lookbackCandles,
    perCandlePercent: 9,
    annualizedPercent: 99,
  }),
};

describe('ClassicMarketData (AI uses the same price feed that settles options)', () => {
  it('uses live 5-minute candles plus the latest live tick when available', async () => {
    const tick = { price: 61_234, timestamp: new Date(NOW).toISOString(), source: 'COINBASE' };
    const md = new ClassicMarketData(feed(liveCandles(100), tick) as never, fallback, () => NOW);
    await md.prepare();
    expect(md.sourceName()).toBe('LIVE');
    const candles = md.getCandles('BTC/USDT', 50);
    expect(candles).toHaveLength(50);
    expect(candles.at(-1)!.close).toBe(61_234); // live tick is the latest close
    expect(md.getSymbols()).toEqual(['BTC/USDT']);
    expect(md.estimateVolatility('BTC/USDT', 24).annualizedPercent).toBeGreaterThan(0);
  });

  it('falls back to the simulator when the live feed errors', async () => {
    const md = new ClassicMarketData(feed(new Error('HTTP 503'), null) as never, fallback, () => NOW);
    await md.prepare();
    expect(md.sourceName()).toBe('SIMULATED');
    expect(md.getCandles('BTC/USDT', 5)[0]!.close).toBe(1);
  });

  it('falls back when live candles are stale, too few, or malformed', async () => {
    const stale = new ClassicMarketData(feed(liveCandles(100, NOW - 60 * 60_000), null) as never, fallback, () => NOW);
    await stale.prepare();
    expect(stale.sourceName()).toBe('SIMULATED');

    const few = new ClassicMarketData(feed(liveCandles(10), null) as never, fallback, () => NOW);
    await few.prepare();
    expect(few.sourceName()).toBe('SIMULATED');

    const bad = liveCandles(100).map((c, i) => (i > 50 ? { ...c, close: Number.NaN } : c));
    const malformed = new ClassicMarketData(feed(bad, null) as never, fallback, () => NOW);
    await malformed.prepare();
    // NaN candles are dropped; the remainder is too old → fallback.
    expect(malformed.sourceName()).toBe('SIMULATED');
  });

  it('ignores an invalid live tick (non-finite / non-positive)', async () => {
    const tick = { price: -5, timestamp: new Date(NOW).toISOString(), source: 'X' };
    const md = new ClassicMarketData(feed(liveCandles(100), tick) as never, fallback, () => NOW);
    await md.prepare();
    expect(md.getCandles('BTC/USDT', 1)[0]!.close).toBeGreaterThan(0);
  });
});
