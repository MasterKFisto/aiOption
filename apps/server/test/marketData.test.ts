import { describe, expect, it } from 'vitest';

import { SimulatedMarketDataService } from '../src/market/marketDataService.js';
import { rsi } from '../src/strategy/indicators.js';

const FIXED_NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const CANDLE_MS = 300_000;

describe('SimulatedMarketDataService', () => {
  const market = new SimulatedMarketDataService({ now: () => FIXED_NOW });

  it('provides BTC/USDT and ETH/USDT', () => {
    expect(market.getSymbols()).toEqual(['BTC/USDT', 'ETH/USDT']);
  });

  it('generates valid, interval-spaced, chained candles', () => {
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
      expect(candles[i]!.timestamp - candles[i - 1]!.timestamp).toBe(CANDLE_MS);
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

  it('produces tickers consistent with the last 24 hours of candles', () => {
    const ticker = market.getTicker('BTC/USDT');
    const candles = market.getCandles('BTC/USDT', 24 * 12 + 1);
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

  it('is deterministic across instances for the same time', () => {
    const other = new SimulatedMarketDataService({ now: () => FIXED_NOW });
    const a = market.getCandles('BTC/USDT', 500).at(-1)!.close;
    const b = other.getCandles('BTC/USDT', 500).at(-1)!.close;
    expect(a).toBe(b);
  });
});

describe('Simulator — mean reversion, oscillation, volatility clustering (Phase 6.5.2)', () => {
  it('advances with time: new candles appear and the latest price changes', () => {
    let now = FIXED_NOW;
    const sim = new SimulatedMarketDataService({ now: () => now });
    const before = sim.getCandles('BTC/USDT', 100);
    now += 3 * CANDLE_MS;
    const after = sim.getCandles('BTC/USDT', 100);
    expect(after.at(-1)!.timestamp - before.at(-1)!.timestamp).toBe(3 * CANDLE_MS);
    // Continuity: the history is preserved, only new candles were appended.
    expect(after.at(-4)!.close).toBe(before.at(-1)!.close);
    expect(after.at(-1)!.close).not.toBe(before.at(-1)!.close);
  });

  it('stays bounded around the mean and never drifts away indefinitely', () => {
    let now = FIXED_NOW;
    const sim = new SimulatedMarketDataService({ now: () => now, maxCandles: 1000 });
    const prices: number[] = [];
    // Simulate ~35 days of 5-minute candles in steps.
    for (let day = 0; day < 35; day++) {
      now += 288 * CANDLE_MS;
      prices.push(...sim.getCandles('BTC/USDT', 288).map((c) => c.close));
    }
    const mean = 60_000;
    for (const p of prices) {
      expect(p).toBeGreaterThan(mean / 1.5);
      expect(p).toBeLessThan(mean * 1.5);
    }
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    expect(Math.abs(avg / mean - 1)).toBeLessThan(0.05); // long-run average ≈ mean
  });

  it('oscillates: crosses the mean repeatedly and produces both up and down 2-hour momentum', () => {
    const sim = new SimulatedMarketDataService({ now: () => FIXED_NOW, maxCandles: 5000 });
    const closes = sim.getCandles('BTC/USDT', 5000).map((c) => c.close);
    let crossings = 0;
    for (let i = 1; i < closes.length; i++) {
      if ((closes[i - 1]! - 60_000) * (closes[i]! - 60_000) < 0) crossings += 1;
    }
    expect(crossings).toBeGreaterThan(20);
    let up = 0;
    let down = 0;
    for (let i = 24; i < closes.length; i += 24) {
      if (closes[i]! > closes[i - 24]!) up += 1;
      else down += 1;
    }
    const share = up / (up + down);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });

  it('reaches both RSI regimes, so the AI must evaluate CALL and PUT conditions', () => {
    const sim = new SimulatedMarketDataService({ now: () => FIXED_NOW, maxCandles: 5000 });
    const closes = sim.getCandles('BTC/USDT', 5000).map((c) => c.close);
    let above50 = 0;
    let below50 = 0;
    for (let i = 70; i < closes.length; i += 10) {
      const value = rsi(closes.slice(i - 70, i), 14)!;
      if (value > 50) above50 += 1;
      else below50 += 1;
    }
    expect(above50).toBeGreaterThan(50);
    expect(below50).toBeGreaterThan(50);
  });

  it('shows volatility clustering (calm and turbulent regimes)', () => {
    const sim = new SimulatedMarketDataService({ now: () => FIXED_NOW, maxCandles: 5000 });
    const closes = sim.getCandles('BTC/USDT', 5000).map((c) => c.close);
    const absReturns = closes.slice(1).map((c, i) => Math.abs(Math.log(c / closes[i]!)));
    // Positive autocorrelation of |returns| is the signature of clustering.
    const m = absReturns.reduce((s, r) => s + r, 0) / absReturns.length;
    let num = 0;
    let den = 0;
    for (let i = 1; i < absReturns.length; i++) {
      num += (absReturns[i]! - m) * (absReturns[i - 1]! - m);
    }
    for (const r of absReturns) den += (r - m) ** 2;
    expect(num / den).toBeGreaterThan(0.05);
  });

  it('respects SIMULATOR_* style parameters (stronger reversion ⇒ tighter range)', () => {
    const range = (kappa: number) => {
      const sim = new SimulatedMarketDataService({
        now: () => FIXED_NOW,
        maxCandles: 3000,
        symbols: [{ symbol: 'BTC/USDT', meanPrice: 60_000, baseVolatility: 0.002, meanReversion: kappa, baseVolume: 1 }],
      });
      const closes = sim.getCandles('BTC/USDT', 3000).map((c) => c.close);
      return Math.max(...closes) / Math.min(...closes);
    };
    expect(range(0.2)).toBeLessThan(range(0.01));
  });
});
