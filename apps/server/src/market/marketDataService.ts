import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';

/** Per-symbol simulation parameters. */
export interface SymbolConfig {
  symbol: string;
  /** Starting price of the simulated series. */
  initialPrice: number;
  /** Per-candle (hourly) log-return volatility, e.g. 0.008 = 0.8%. */
  perCandleVol: number;
  /** Per-candle drift (expected log return). */
  drift: number;
  /** Base volume per candle. */
  baseVolume: number;
}

const DEFAULT_SYMBOLS: SymbolConfig[] = [
  { symbol: 'BTC/USDT', initialPrice: 67_000, perCandleVol: 0.008, drift: 0.0003, baseVolume: 250 },
  { symbol: 'ETH/USDT', initialPrice: 2_600, perCandleVol: 0.01, drift: 0.0004, baseVolume: 3_200 },
];

const CANDLE_MS = 3_600_000; // hourly candles
const HOURS_PER_YEAR = 24 * 365.25;

/* ------------------------- deterministic randomness ------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform: standard normal from uniform RNG. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic simulated market data for paper trading: generates realistic
 * synthetic OHLCV candles (geometric Brownian motion, hourly) and current
 * tickers for BTC/USDT and ETH/USDT, and estimates historical volatility.
 *
 * The same symbol always produces the same series, so backtests and signal
 * evaluations are reproducible across runs and processes.
 */
export class SimulatedMarketDataService {
  private readonly configs = new Map<string, SymbolConfig>();
  private readonly candleCache = new Map<string, Candle[]>();
  private readonly maxCandles: number;

  constructor(options: { symbols?: SymbolConfig[]; maxCandles?: number } = {}) {
    this.maxCandles = options.maxCandles ?? 1000;
    for (const cfg of options.symbols ?? DEFAULT_SYMBOLS) {
      this.configs.set(cfg.symbol, cfg);
    }
  }

  getSymbols(): string[] {
    return [...this.configs.keys()];
  }

  /** Returns the most recent `count` hourly candles (oldest first). */
  getCandles(symbol: string, count = 168): Candle[] {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`count must be a positive integer, got ${count}`);
    }
    const cfg = this.requireConfig(symbol);
    const cached = this.candleCache.get(symbol);
    if (cached && cached.length >= count) {
      return cached.slice(-count);
    }
    const series = this.generateCandles(cfg, Math.max(count, this.maxCandles));
    this.candleCache.set(symbol, series);
    return series.slice(-count);
  }

  /** Current ticker derived from the latest candles. */
  getTicker(symbol: string): Ticker {
    const candles = this.getCandles(symbol, 25);
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const price = last.close;
    const change = price - first.close;
    return {
      symbol,
      lastPrice: price,
      bid: price * (1 - 0.0005),
      ask: price * (1 + 0.0005),
      priceChange24h: change,
      priceChangePercent24h: (change / first.close) * 100,
      high24h: Math.max(...candles.map((c) => c.high)),
      low24h: Math.min(...candles.map((c) => c.low)),
      volume24h: candles.reduce((sum, c) => sum + c.volume, 0),
      timestamp: last.timestamp + CANDLE_MS,
    };
  }

  /** Simple historical volatility over the last `lookbackCandles` candles. */
  estimateVolatility(symbol: string, lookbackCandles = 24): VolatilityEstimate {
    if (!Number.isInteger(lookbackCandles) || lookbackCandles < 2) {
      throw new Error(`lookbackCandles must be an integer >= 2, got ${lookbackCandles}`);
    }
    const candles = this.getCandles(symbol, lookbackCandles + 1);
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push(Math.log(candles[i]!.close / candles[i - 1]!.close));
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return {
      symbol,
      lookbackCandles,
      perCandlePercent: std * 100,
      annualizedPercent: std * Math.sqrt(HOURS_PER_YEAR) * 100,
    };
  }

  private requireConfig(symbol: string): SymbolConfig {
    const cfg = this.configs.get(symbol);
    if (!cfg) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }
    return cfg;
  }

  private generateCandles(cfg: SymbolConfig, count: number): Candle[] {
    const rng = mulberry32(hashString(cfg.symbol));
    const end = Date.now();
    let price = cfg.initialPrice;
    const candles: Candle[] = [];

    for (let i = 0; i < count; i++) {
      const open = price;
      const z = gaussian(rng);
      // perCandleVol is per-candle (hourly) log-return volatility, so no
      // time scaling is applied: ret = drift + sigma * z.
      const ret = cfg.drift + cfg.perCandleVol * z;
      const close = open * Math.exp(ret);
      const high = Math.max(open, close) * (1 + rng() * 0.004);
      const low = Math.min(open, close) * (1 - rng() * 0.004);
      const volume = cfg.baseVolume * (1 + Math.abs(ret) * 30) * (0.7 + rng() * 0.6);

      candles.push({
        timestamp: end - (count - 1 - i) * CANDLE_MS,
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }
    return candles;
  }
}
