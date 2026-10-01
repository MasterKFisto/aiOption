import type { AiAction, AiDecision, Candle, MarketSignal, Ticker, VolatilityEstimate } from '@aioption/shared';

import { config } from '../config.js';
import { logAiDecision } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';

/** Minimal market-data surface the signal engine depends on (easy to stub in tests). */
export interface MarketDataProvider {
  getSymbols(): string[];
  getCandles(symbol: string, count?: number): Candle[];
  getTicker(symbol: string): Ticker;
  estimateVolatility(symbol: string, lookbackCandles?: number): VolatilityEstimate;
}

export interface SignalEngineOptions {
  /** Number of candles used for the momentum lookback. */
  momentumPeriod?: number;
  /** Number of candles used for the volatility estimate. */
  volatilityPeriod?: number;
  /** Annualized volatility (%) above which the market is too volatile → NEUTRAL. */
  volatilityThreshold?: number;
  /** Momentum magnitude (%) at which the confidence score saturates. */
  momentumSaturation?: number;
}

const DEFAULTS: Required<SignalEngineOptions> = {
  momentumPeriod: 24,
  volatilityPeriod: 24,
  // Crypto is volatile: ~100% annualized is typical in simulation, so the
  // "calm enough to trade" bar sits at 120%.
  volatilityThreshold: 120,
  momentumSaturation: 5,
};

/** Maps a market outlook to the suggested trade action. */
const SIGNAL_TO_ACTION: Record<MarketSignal, AiAction> = {
  BULLISH: 'OPEN_CALL',
  BEARISH: 'OPEN_PUT',
  NEUTRAL: 'HOLD',
};

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Rule-based "AI" signal engine (deterministic MVP):
 *
 *   momentum  = % price change over the last N candles
 *   volatility >  threshold  → NEUTRAL
 *   momentum  >  0           → BULLISH
 *   momentum  <  0           → BEARISH
 *   otherwise                → NEUTRAL
 *
 * Every evaluation is persisted via the ai_decisions repository and returned.
 */
export class SignalEngine {
  private readonly options: Required<SignalEngineOptions>;

  constructor(
    private readonly market: MarketDataProvider,
    options: SignalEngineOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Evaluates one symbol, saves the decision to the DB, and returns it. */
  evaluate(symbol: string): AiDecision {
    const candles = this.market.getCandles(symbol, this.options.momentumPeriod + 1);
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;

    const momentumPercent = ((last.close - first.close) / first.close) * 100;
    const volatility = this.market.estimateVolatility(symbol, this.options.volatilityPeriod);
    const volPercent = volatility.annualizedPercent;

    let signal: MarketSignal;
    let confidence: number;
    let expectedReturnPercent: number;

    if (volPercent >= this.options.volatilityThreshold) {
      signal = 'NEUTRAL';
      confidence = 0.5;
      expectedReturnPercent = 0;
    } else if (momentumPercent > 0) {
      signal = 'BULLISH';
      confidence = this.confidenceFor(Math.abs(momentumPercent), volPercent);
      expectedReturnPercent = momentumPercent;
    } else if (momentumPercent < 0) {
      signal = 'BEARISH';
      confidence = this.confidenceFor(Math.abs(momentumPercent), volPercent);
      expectedReturnPercent = momentumPercent;
    } else {
      signal = 'NEUTRAL';
      confidence = 0.5;
      expectedReturnPercent = 0;
    }

    const rationale =
      signal === 'NEUTRAL'
        ? `NEUTRAL: momentum ${momentumPercent.toFixed(2)}%, volatility ${volPercent.toFixed(1)}% ` +
          `(threshold ${this.options.volatilityThreshold}%)`
        : `${signal}: momentum ${momentumPercent.toFixed(2)}% over ${this.options.momentumPeriod} candles, ` +
          `volatility ${volPercent.toFixed(1)}% (below ${this.options.volatilityThreshold}%)`;

    const decision = logAiDecision({
      symbol,
      signal,
      action: SIGNAL_TO_ACTION[signal],
      confidence,
      expectedReturn: round4(expectedReturnPercent / 100),
      proposedTradeSizeUsd: config.FIXED_TRADE_SIZE_USD,
      rationale,
      executed: false,
      positionId: null,
    });
    publishEvent('decision', decision);
    return decision;
  }

  /** Evaluates every configured symbol. */
  generateAll(): AiDecision[] {
    return this.market.getSymbols().map((symbol) => this.evaluate(symbol));
  }

  private confidenceFor(absMomentumPercent: number, volPercent: number): number {
    const momentumScore = Math.min(absMomentumPercent / this.options.momentumSaturation, 1);
    const calmnessScore = Math.max(1 - volPercent / this.options.volatilityThreshold, 0);
    return round4(clamp(0.5 + 0.25 * momentumScore + 0.2 * calmnessScore, 0.5, 0.95));
  }
}
