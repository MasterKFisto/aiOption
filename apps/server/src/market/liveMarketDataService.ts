import { logger } from '../logger.js';
import { config } from '../config.js';
import type { Candle, LiveTicker, MarketConnectionStatus, PriceTick } from '@aioption/shared';

/** Minimal fetch-based market data source (injectable for tests). */
export interface MarketDataSource {
  /** 24h stats: last price + open/high/low/volume. */
  fetchStats(symbol: string): Promise<{
    last: number;
    open: number;
    high: number;
    low: number;
    volume: number;
  }>;
  /** OHLCV candles, oldest first. */
  fetchCandles(symbol: string, granularitySeconds: number, limit: number): Promise<Candle[]>;
}

const COINBASE_BASE = 'https://api.exchange.coinbase.com';

/** Safe symbol pattern: uppercase base/quote pairs, e.g. BTC/USDT, BTC-USDT. */
const SAFE_SYMBOL = /^[A-Z0-9]{1,16}(?:[/-][A-Z0-9]{1,16})?$/;

const toCoinbaseSymbol = (symbol: string): string => {
  const normalized = symbol.toUpperCase();
  if (!SAFE_SYMBOL.test(normalized)) {
    throw new Error(`invalid market symbol: ${symbol}`);
  }
  return normalized.replace('/', '-');
};

/** Coinbase Exchange public REST source (no API key needed). */
export class CoinbaseMarketDataSource implements MarketDataSource {
  async fetchStats(symbol: string) {
    const id = toCoinbaseSymbol(symbol);
    // `/ticker` gives the real-time last trade price; `/stats` provides the
    // 24h aggregates (its `last` is minute-cached and unsuitable for
    // second-level pricing, e.g. binary settlement).
    const [tickerRes, statsRes] = await Promise.all([
      fetch(`${COINBASE_BASE}/products/${id}/ticker`),
      fetch(`${COINBASE_BASE}/products/${id}/stats`),
    ]);
    if (!tickerRes.ok || !statsRes.ok) {
      throw new Error(
        `coinbase stats ${symbol}: HTTP ${!tickerRes.ok ? tickerRes.status : statsRes.status}`,
      );
    }
    const ticker = (await tickerRes.json()) as { price: string };
    const stats = (await statsRes.json()) as {
      open: string;
      high: string;
      low: string;
      volume: string;
    };
    return {
      last: Number(ticker.price),
      open: Number(stats.open),
      high: Number(stats.high),
      low: Number(stats.low),
      volume: Number(stats.volume),
    };
  }

  async fetchCandles(symbol: string, granularitySeconds: number, limit: number): Promise<Candle[]> {
    const url =
      `${COINBASE_BASE}/products/${toCoinbaseSymbol(symbol)}/candles` +
      `?granularity=${granularitySeconds}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`coinbase candles ${symbol}: HTTP ${res.status}`);
    }
    // Coinbase returns [time, low, high, open, close, volume], newest first.
    const raw = (await res.json()) as Array<[number, number, number, number, number, number]>;
    return raw
      .map(([time, low, high, open, close, volume]) => ({
        timestamp: time * 1000,
        open,
        high,
        low,
        close,
        volume,
      }))
      .reverse();
  }
}

export const CANDLE_INTERVALS = ['1m', '5m', '1h'] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  '1m': 60,
  '5m': 300,
  '1h': 3600,
};

export const intervalToSeconds = (interval: string): number | null =>
  (INTERVAL_SECONDS as Record<string, number>)[interval] ?? null;

/**
 * Polls a public market data source for a live ticker. If the primary symbol
 * is unavailable, it falls back to the configured fallback symbol and reports
 * it via the ticker so the UI can label the data source.
 */
export class LiveMarketDataService {
  private ticker: LiveTicker | null = null;
  private status: MarketConnectionStatus = 'polling';
  private usingFallback = false;
  private timer: NodeJS.Timeout | null = null;
  /** Rolling buffer of recent price observations (newest last). */
  private readonly ticks: PriceTick[] = [];

  constructor(
    private readonly source: MarketDataSource,
    private readonly options: {
      symbol: string;
      fallbackSymbol: string;
      pollIntervalMs: number;
      sourceName?: string;
    },
  ) {}

  getStatus(): MarketConnectionStatus {
    return this.status;
  }

  getTicker(): LiveTicker | null {
    return this.ticker;
  }

  /** Latest price observation (newest tick), if any. */
  getLatestTick(): PriceTick | null {
    return this.ticks.at(-1) ?? null;
  }

  /** The most recent `limit` ticks (oldest first). */
  getRecentTicks(limit = 100): PriceTick[] {
    return this.ticks.slice(-limit);
  }

  /** The most recent tick at or after the given timestamp, if any. */
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

  /** Returns candles for the active symbol (primary or fallback). */
  async getCandles(interval: CandleInterval, limit: number): Promise<Candle[]> {
    const symbol = this.activeSymbol();
    return this.source.fetchCandles(symbol, INTERVAL_SECONDS[interval], limit);
  }

  /** Polls immediately (exposed for tests and manual refreshes). */
  async refresh(): Promise<void> {
    await this.poll();
  }

  /** Starts the polling loop. */
  start(): void {
    if (this.timer) {
      return;
    }
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.options.pollIntervalMs);
    logger.info(
      { symbol: this.options.symbol, intervalMs: this.options.pollIntervalMs },
      'live market polling started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status = 'disconnected';
  }

  private activeSymbol(): string {
    return this.usingFallback ? this.options.fallbackSymbol : this.options.symbol;
  }

  private async poll(): Promise<void> {
    const symbol = this.activeSymbol();
    try {
      const stats = await this.source.fetchStats(symbol);
      const change = stats.last - stats.open;
      this.ticker = {
        status: 'connected',
        source: this.options.sourceName ?? 'COINBASE',
        symbol,
        requestedSymbol: this.options.symbol,
        usingFallback: this.usingFallback,
        lastPrice: stats.last,
        priceChange24h: change,
        priceChangePercent24h: stats.open !== 0 ? (change / stats.open) * 100 : 0,
        high24h: stats.high,
        low24h: stats.low,
        volume24h: stats.volume,
        lastUpdatedAt: new Date().toISOString(),
      };
      this.status = 'connected';
      this.ticks.push({
        price: stats.last,
        timestamp: new Date().toISOString(),
        source: this.options.sourceName ?? 'COINBASE',
      });
      if (this.ticks.length > 100) {
        this.ticks.shift();
      }
    } catch (err) {
      if (!this.usingFallback && this.options.fallbackSymbol !== this.options.symbol) {
        this.usingFallback = true;
        this.status = 'polling';
        logger.warn(
          { symbol, fallback: this.options.fallbackSymbol },
          'primary market symbol unavailable — switching to fallback',
        );
        // Retry immediately with the fallback symbol.
        await this.poll();
        return;
      }
      this.status = 'error';
      logger.error({ symbol, err }, 'live market poll failed');
    }
  }
}

/** Singleton used by the app and the market routes. */
export const liveMarket = new LiveMarketDataService(new CoinbaseMarketDataSource(), {
  symbol: config.MARKET_SYMBOL,
  fallbackSymbol: config.FALLBACK_MARKET_SYMBOL,
  pollIntervalMs: config.MARKET_POLL_INTERVAL_MS,
});
