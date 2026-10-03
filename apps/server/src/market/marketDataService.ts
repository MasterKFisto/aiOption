import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';

import { config } from '../config.js';

/** Per-symbol simulation parameters. */
export interface SymbolConfig {
  symbol: string;
  /** Long-term mean price the series reverts to. */
  meanPrice: number;
  /** Long-run per-candle log-return volatility, e.g. 0.002 = 0.2%. */
  baseVolatility: number;
  /** Per-candle pull toward the mean in log space (0 = pure random walk). */
  meanReversion: number;
  /** Base volume per candle. */
  baseVolume: number;
}

export interface SimulatorOptions {
  symbols?: SymbolConfig[];
  /** Candles kept per symbol (history window). */
  maxCandles?: number;
  /** Candle interval in ms. */
  candleMs?: number;
  /** Clock (injectable for tests). */
  now?: () => number;
  /** Seed salt — same seed + same time ⇒ identical series. */
  seed?: string;
}

/** Default symbols, parameterized from SIMULATOR_* configuration. */
export function defaultSymbols(): SymbolConfig[] {
  return [
    {
      symbol: 'BTC/USDT',
      meanPrice: config.SIMULATOR_BTC_MEAN_PRICE,
      baseVolatility: config.SIMULATOR_BASE_VOLATILITY,
      meanReversion: config.SIMULATOR_MEAN_REVERSION_STRENGTH,
      baseVolume: 250,
    },
    {
      symbol: 'ETH/USDT',
      meanPrice: 2_600,
      baseVolatility: config.SIMULATOR_BASE_VOLATILITY * 1.25,
      meanReversion: config.SIMULATOR_MEAN_REVERSION_STRENGTH,
      baseVolume: 3_200,
    },
  ];
}

const YEAR_MS = 365.25 * 24 * 3_600_000;
/** GARCH(1,1) persistence: volatility clustering (alpha + beta < 1 ⇒ stationary). */
const GARCH_ALPHA = 0.1;
const GARCH_BETA = 0.85;
/** Candles simulated before the visible window so the process is at steady state. */
const WARMUP_CANDLES = 300;
/** Hard bound on |log(price/mean)| — prices can never run away. */
const MAX_LOG_DEVIATION = Math.log(1.5);

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

interface SeriesState {
  /** Simulated candles, oldest first (bounded to maxCandles). */
  candles: Candle[];
  rng: () => number;
  /** log(price / mean) after the last candle. */
  logDeviation: number;
  /** Current GARCH conditional variance per candle. */
  variance: number;
  /** Last shock for the GARCH update. */
  lastShock: number;
}

/**
 * Simulated market data for paper trading (Phase 6.5.2 rewrite).
 *
 * Old model: geometric Brownian motion with a positive drift and a FIXED
 * seed regenerated relative to "now" — the series shape never changed, so the
 * 24-candle momentum stayed constant and the AI repeated the same signal
 * (PUT on BTC) for hours.
 *
 * New model, per candle:
 *   - Mean-reverting random walk (discrete Ornstein–Uhlenbeck on log price):
 *       x' = x · (1 − κ) + σ_t · z,   x = log(price / mean)
 *     The further from the mean, the stronger the pull back, so the series
 *     oscillates instead of trending forever; |x| is also hard-bounded.
 *   - Volatility clustering via GARCH(1,1):
 *       σ²_t = ω + α·ε²_{t−1} + β·σ²_{t−1},   ω = σ̄²·(1 − α − β)
 *   - Time-advancing: candles align to wall-clock intervals and new candles
 *     are appended as time passes, so each evaluation sees new data.
 *     Same seed + same time ⇒ same series (deterministic tests).
 */
export class SimulatedMarketDataService {
  private readonly configs = new Map<string, SymbolConfig>();
  private readonly series = new Map<string, SeriesState>();
  private readonly maxCandles: number;
  private readonly candleMs: number;
  private readonly now: () => number;
  private readonly seed: string;

  constructor(options: SimulatorOptions = {}) {
    this.maxCandles = options.maxCandles ?? 1000;
    this.candleMs = options.candleMs ?? config.SIMULATOR_CANDLE_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.seed = options.seed ?? 'aioption-sim';
    for (const cfg of options.symbols ?? defaultSymbols()) {
      this.configs.set(cfg.symbol, cfg);
    }
  }

  getSymbols(): string[] {
    return [...this.configs.keys()];
  }

  /** Candle interval in ms. */
  get intervalMs(): number {
    return this.candleMs;
  }

  /** Returns the most recent `count` candles (oldest first), advanced to "now". */
  getCandles(symbol: string, count = 168): Candle[] {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`count must be a positive integer, got ${count}`);
    }
    const cfg = this.requireConfig(symbol);
    const state = this.advance(cfg, Math.max(count, this.maxCandles));
    return state.candles.slice(-count);
  }

  /** Current ticker derived from the last 24 hours of candles. */
  getTicker(symbol: string): Ticker {
    const perDay = Math.max(2, Math.round((24 * 3_600_000) / this.candleMs) + 1);
    const candles = this.getCandles(symbol, perDay);
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
      timestamp: last.timestamp + this.candleMs,
    };
  }

  /** Historical volatility over the last `lookbackCandles` candles. */
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
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return {
      symbol,
      lookbackCandles,
      perCandlePercent: std * 100,
      annualizedPercent: std * Math.sqrt(YEAR_MS / this.candleMs) * 100,
    };
  }

  private requireConfig(symbol: string): SymbolConfig {
    const cfg = this.configs.get(symbol);
    if (!cfg) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }
    return cfg;
  }

  /**
   * Ensures the series covers the current interval and holds at least
   * `minCandles` candles, appending new candles as wall-clock time passes.
   */
  private advance(cfg: SymbolConfig, minCandles: number): SeriesState {
    const currentStart = Math.floor(this.now() / this.candleMs) * this.candleMs;
    let state = this.series.get(cfg.symbol);
    if (!state || state.candles.length < minCandles) {
      state = this.bootstrap(cfg, currentStart, minCandles);
      this.series.set(cfg.symbol, state);
      return state;
    }
    let lastStart = state.candles[state.candles.length - 1]!.timestamp;
    if ((currentStart - lastStart) / this.candleMs > this.maxCandles) {
      // Long idle gap: restart from steady state instead of simulating it all.
      state = this.bootstrap(cfg, currentStart, minCandles);
      this.series.set(cfg.symbol, state);
      return state;
    }
    while (lastStart < currentStart) {
      lastStart += this.candleMs;
      state.candles.push(this.step(cfg, state, lastStart));
    }
    const keep = Math.max(minCandles, this.maxCandles);
    if (state.candles.length > keep) {
      state.candles.splice(0, state.candles.length - keep);
    }
    return state;
  }

  /** Builds a fresh series ending at `endStart`, after a warm-up period. */
  private bootstrap(cfg: SymbolConfig, endStart: number, count: number): SeriesState {
    const firstStart = endStart - (count - 1) * this.candleMs;
    const warmupStart = firstStart - WARMUP_CANDLES * this.candleMs;
    const state: SeriesState = {
      candles: [],
      rng: mulberry32(hashString(`${this.seed}:${cfg.symbol}:${warmupStart}`)),
      logDeviation: 0,
      variance: cfg.baseVolatility ** 2,
      lastShock: 0,
    };
    for (let i = 0; i < WARMUP_CANDLES; i++) {
      this.step(cfg, state, warmupStart + i * this.candleMs);
    }
    for (let i = 0; i < count; i++) {
      state.candles.push(this.step(cfg, state, firstStart + i * this.candleMs));
    }
    return state;
  }

  /** Simulates one candle: OU mean reversion on log price + GARCH(1,1) volatility. */
  private step(cfg: SymbolConfig, state: SeriesState, timestamp: number): Candle {
    const longRunVar = cfg.baseVolatility ** 2;
    const omega = longRunVar * (1 - GARCH_ALPHA - GARCH_BETA);
    state.variance = omega + GARCH_ALPHA * state.lastShock ** 2 + GARCH_BETA * state.variance;
    state.variance = Math.min(state.variance, 25 * longRunVar); // cap at 5× base vol
    const sigma = Math.sqrt(state.variance);

    const shock = sigma * gaussian(state.rng);
    const prev = state.logDeviation;
    let next = prev * (1 - cfg.meanReversion) + shock;
    next = Math.max(-MAX_LOG_DEVIATION, Math.min(MAX_LOG_DEVIATION, next));
    state.logDeviation = next;
    state.lastShock = shock;

    const open = cfg.meanPrice * Math.exp(prev);
    const close = cfg.meanPrice * Math.exp(next);
    const wick = sigma * 0.5;
    const high = Math.max(open, close) * (1 + state.rng() * wick);
    const low = Math.min(open, close) * (1 - state.rng() * wick);
    const move = Math.abs(next - prev);
    const volume =
      cfg.baseVolume * (1 + (move / cfg.baseVolatility) * 0.3) * (0.7 + state.rng() * 0.6);
    return { timestamp, open, high, low, close, volume };
  }
}

