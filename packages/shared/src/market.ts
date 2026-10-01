/**
 * Market data shapes shared by the market data service, the signal engine,
 * and (later) the web frontend.
 */

/** OHLCV candle; timestamp is the candle open time (epoch ms). */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Current market snapshot for a symbol. */
export interface Ticker {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  /** Absolute price change over the last 24 hours. */
  priceChange24h: number;
  /** Price change over the last 24 hours, in percent. */
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

/** Historical volatility estimate over a candle lookback window. */
export interface VolatilityEstimate {
  symbol: string;
  lookbackCandles: number;
  /** Standard deviation of log returns per candle, in percent. */
  perCandlePercent: number;
  /** Annualized volatility in percent (scaled by candles-per-year). */
  annualizedPercent: number;
}

/** Connection state of the live market data feed. */
export type MarketConnectionStatus = 'connected' | 'polling' | 'disconnected' | 'error';

/** Live ticker snapshot from the public market data source. */
export interface LiveTicker {
  status: MarketConnectionStatus;
  /** Data source name, e.g. COINBASE. */
  source: string;
  /** Symbol actually used (may differ from requestedSymbol when falling back). */
  symbol: string;
  requestedSymbol: string;
  usingFallback: boolean;
  lastPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  lastUpdatedAt: string;
}
