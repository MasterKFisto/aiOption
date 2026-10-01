import { describe, expect, it } from 'vitest';

import { SimulatedMarketDataService } from '../src/market/marketDataService.js';

describe('SimulatedMarketDataService', () => {
  const market = new SimulatedMarketDataService();

  it('provides BTC/USDT and ETH/USDT', () => {
    expect(market.getSymbols()).toEqual(['BTC/USDT', 'ETH/USDT']);
  });

  it('generates valid, hourly, chained candles', () => {
    const candles = market.getCandles('BTC/USDT', 168);
    expect(candles).toHaveLength(168);
    for (const c of candles) {
      expect(c.open).toBeGreaterThan(0);
      expect(c.close).toBeGreaterThan(0);
      expect(c.low).toBeGreaterThan(0);
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.volume).toBeGreaterThan(0);
    }
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp - candles[i - 1]!.timestamp).toBe(3_600_000);
      expect(candles[i]!.open).toBe(candles[i - 1]!.close);
    }
  });

  it('returns the requested count even beyond the default cache size', () => {
    expect(market.getCandles('ETH/USDT', 1200)).toHaveLength(1200);
  });

  it('rejects invalid counts and unknown symbols', () => {
    expect(() => market.getCandles('BTC/USDT', 0)).toThrow(/positive integer/);
    expect(() => market.getCandles('BTC/USDT', -5)).toThrow(/positive integer/);
    expect(() => market.getCandles('DOGE/USDT')).toThrow(/Unknown symbol/);
  });

  it('produces tickers consistent with the candles', () => {
    const ticker = market.getTicker('BTC/USDT');
    const candles = market.getCandles('BTC/USDT', 25);
    expect(ticker.lastPrice).toBe(candles.at(-1)!.close);
    expect(ticker.priceChange24h).toBe(candles.at(-1)!.close - candles[0]!.close);
    expect(ticker.bid).toBeLessThan(ticker.ask);
    expect(ticker.high24h).toBeGreaterThanOrEqual(ticker.low24h);
    expect(ticker.volume24h).toBeGreaterThan(0);
  });

  it('estimates plausible volatility', () => {
    const vol = market.estimateVolatility('BTC/USDT', 24);
    expect(vol.perCandlePercent).toBeGreaterThan(0);
    expect(vol.perCandlePercent).toBeLessThan(5);
    expect(vol.annualizedPercent).toBeGreaterThan(vol.perCandlePercent);
    expect(vol.lookbackCandles).toBe(24);
  });

  it('rejects lookbacks shorter than 2 candles', () => {
    expect(() => market.estimateVolatility('BTC/USDT', 1)).toThrow(/>= 2/);
    expect(() => market.estimateVolatility('BTC/USDT', 0)).toThrow(/>= 2/);
  });

  it('is deterministic across instances', () => {
    const other = new SimulatedMarketDataService();
    const a = market.getCandles('BTC/USDT', 500).at(-1)!.close;
    const b = other.getCandles('BTC/USDT', 500).at(-1)!.close;
    expect(a).toBe(b);
  });
});
