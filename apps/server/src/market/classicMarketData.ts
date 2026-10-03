import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';

import { logger } from '../logger.js';
import type { MarketDataProvider } from '../strategy/signalEngine.js';
import { liveMarket } from './liveMarketDataService.js';
import type { LiveMarketDataService } from './liveMarketDataService.js';
import { SimulatedMarketDataService } from './marketDataService.js';

/** Classic options trade BTC only; the AI evaluates this one symbol. */
export const CLASSIC_SYMBOL = 'BTC/USDT';
const CANDLE_LIMIT = 300;
const CANDLE_MS = 300_000;
const YEAR_MS = 365.25 * 24 * 3_600_000;
/** Live candles older than this are considered unusable. */
const MAX_CANDLE_AGE_MS = 15 * 60_000;

/**
 * Market data for the Classic AI (Phase 6.5.2 fix).
 *
 * Bug fixed: the AI used to evaluate a SYNTHETIC price series (centred on a
 * made-up mean) while Classic options SETTLE against the real Coinbase BTC
 * price. Signals were therefore unrelated to the price that decides win/loss.
 *
 * Now: before each loop tick `prepare()` loads real 5-minute candles from the
 * live feed and appends the latest live tick, so RSI / momentum / volatility
 * describe the same price the option settles on. If the live feed is down or
 * stale, it falls back to the mean-reverting simulator (paper testing) and
 * reports `sourceName() === 'SIMULATED'` in every decision.
 */
export class ClassicMarketData implements MarketDataProvider {
  private candles: Candle[] = [];
  private live = false;

  constructor(
    private readonly feed: Pick<LiveMarketDataService, 'getCandles' | 'getLatestTick'> = liveMarket,
    private readonly fallback: MarketDataProvider = new SimulatedMarketDataService(),
    private readonly now: () => number = Date.now,
  ) {}

  getSymbols(): string[] {
    return [CLASSIC_SYMBOL];
  }

  sourceName(): string {
    return this.live ? 'LIVE' : 'SIMULATED';
  }

  async prepare(): Promise<void> {
    try {
      const candles = await this.feed.getCandles('5m', CANDLE_LIMIT);
      const valid = candles.filter(
        (c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0),
      );
      const last = valid.at(-1);
      if (!last || valid.length < 30 || this.now() - last.timestamp > MAX_CANDLE_AGE_MS) {
        throw new Error('live candles unavailable or stale');
      }
      // Append the newest live tick as the in-progress close.
      const tick = this.feed.getLatestTick();
      if (tick && Number.isFinite(tick.price) && tick.price > 0) {
        valid.push({
          timestamp: last.timestamp + CANDLE_MS,
          open: last.close,
          high: Math.max(last.close, tick.price),
          low: Math.min(last.close, tick.price),
          close: tick.price,
          volume: 0,
        });
      }
      this.candles = valid;
      this.live = true;
    } catch (err) {
      if (this.live) {
        logger.warn({ err }, 'classic AI: live candles unavailable — using simulator');
      }
      this.live = false;
      this.candles = [];
    }
  }

  getCandles(symbol: string, count = 168): Candle[] {
    if (!this.live) {
      return this.fallback.getCandles(CLASSIC_SYMBOL, count);
    }
    void symbol;
    return this.candles.slice(-count);
  }

  getTicker(symbol: string): Ticker {
    if (!this.live) {
      return this.fallback.getTicker(CLASSIC_SYMBOL);
    }
    void symbol;
    const day = this.candles.slice(-289);
    const first = day[0]!;
    const last = day[day.length - 1]!;
    const change = last.close - first.close;
    return {
      symbol: CLASSIC_SYMBOL,
      lastPrice: last.close,
      bid: last.close,
      ask: last.close,
      priceChange24h: change,
      priceChangePercent24h: (change / first.close) * 100,
      high24h: Math.max(...day.map((c) => c.high)),
      low24h: Math.min(...day.map((c) => c.low)),
      volume24h: day.reduce((s, c) => s + c.volume, 0),
      timestamp: last.timestamp,
    };
  }

  estimateVolatility(symbol: string, lookbackCandles = 24): VolatilityEstimate {
    if (!this.live) {
      return this.fallback.estimateVolatility(CLASSIC_SYMBOL, lookbackCandles);
    }
    const closes = this.candles.slice(-(lookbackCandles + 1)).map((c) => c.close);
    const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]!));
    const mean = returns.reduce((s, r) => s + r, 0) / Math.max(returns.length, 1);
    const variance =
      returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
    const std = Math.sqrt(variance);
    return {
      symbol,
      lookbackCandles,
      perCandlePercent: std * 100,
      annualizedPercent: std * Math.sqrt(YEAR_MS / CANDLE_MS) * 100,
    };
  }
}
