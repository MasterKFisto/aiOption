import type {
  AiAction,
  AiDecision,
  AiDecisionFeatures,
  Candle,
  MarketSignal,
  Ticker,
  VolatilityEstimate,
} from '@aioption/shared';

import { config } from '../config.js';
import { logAiDecision } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { getStrategySettings } from './classicStrategySettings.js';
import { DirectionGuard, directionGuard } from './directionGuard.js';
import type { Direction } from './directionGuard.js';
import { rsi } from './indicators.js';

/** Minimal market-data surface the signal engine depends on (easy to stub in tests). */
export interface MarketDataProvider {
  getSymbols(): string[];
  getCandles(symbol: string, count?: number): Candle[];
  getTicker(symbol: string): Ticker;
  estimateVolatility(symbol: string, lookbackCandles?: number): VolatilityEstimate;
  /** Optional async refresh before each evaluation round (live data). */
  prepare?(): Promise<void>;
  /** Optional name of the data source actually used (LIVE / SIMULATED). */
  sourceName?(symbol: string): string;
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
  /** Direction streak / flip guard (injectable for tests). */
  guard?: DirectionGuard;
}

const DEFAULTS: Required<Omit<SignalEngineOptions, 'guard'>> = {
  momentumPeriod: 24,
  volatilityPeriod: 24,
  // Crypto is volatile: ~100% annualized is typical in simulation, so the
  // "calm enough to trade" bar sits at 120%.
  volatilityThreshold: 120,
  momentumSaturation: 5,
};

/** Candles needed for RSI with Wilder smoothing to be well seeded. */
const RSI_HISTORY_FACTOR = 5;

/** Maps a market outlook to the suggested trade action. */
const SIGNAL_TO_ACTION: Record<MarketSignal, AiAction> = {
  BULLISH: 'OPEN_CALL',
  BEARISH: 'OPEN_PUT',
  NEUTRAL: 'HOLD',
};

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Rule-based "AI" signal engine (Phase 6.5.2):
 *
 *   1. raw direction   momentum (% change over N candles): >0 CALL, <0 PUT
 *   2. volatility      annualized vol ≥ threshold          → NEUTRAL
 *   3. RSI regime      momentum up   but RSI > overbought  → NEUTRAL (no CALL)
 *                      momentum down but RSI < oversold    → NEUTRAL (no PUT)
 *   4. flip guard      CALL ↔ PUT requires a NEUTRAL in between (optional)
 *
 * Settings are read on every evaluation (UI changes apply immediately). Every
 * evaluation is persisted with a full indicator snapshot (features_json) so
 * the UI can show exactly why each direction was chosen or rejected.
 */
export class SignalEngine {
  private readonly options: Required<Omit<SignalEngineOptions, 'guard'>>;
  private readonly guard: DirectionGuard;

  constructor(
    private readonly market: MarketDataProvider,
    options: SignalEngineOptions = {},
  ) {
    const { guard, ...rest } = options;
    this.options = { ...DEFAULTS, ...rest };
    this.guard = guard ?? directionGuard;
  }

  /** Evaluates one symbol, saves the decision (with features) and returns it. */
  evaluate(symbol: string): AiDecision {
    const strategy = getStrategySettings();
    const lookback = Math.max(this.options.momentumPeriod + 1, strategy.rsiPeriod * RSI_HISTORY_FACTOR);
    const candles = this.market.getCandles(symbol, lookback);
    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1]!;
    const momentumBase = closes[Math.max(0, closes.length - 1 - this.options.momentumPeriod)]!;

    const momentumPercent = ((last - momentumBase) / momentumBase) * 100;
    const volPercent = this.market.estimateVolatility(symbol, this.options.volatilityPeriod).annualizedPercent;
    const rsiValue = rsi(closes, strategy.rsiPeriod);
    const regime: AiDecisionFeatures['regime'] =
      rsiValue === null
        ? 'UNKNOWN'
        : rsiValue > strategy.rsiOverbought
          ? 'OVERBOUGHT'
          : rsiValue < strategy.rsiOversold
            ? 'OVERSOLD'
            : 'NORMAL';

    const rawSignal: MarketSignal =
      momentumPercent > 0 ? 'BULLISH' : momentumPercent < 0 ? 'BEARISH' : 'NEUTRAL';
    const rsiText = rsiValue === null ? 'n/a' : rsiValue.toFixed(1);

    let signal: MarketSignal = rawSignal;
    let filterReason: string | null = null;
    let rebalance: string | null = null;
    if (volPercent >= this.options.volatilityThreshold) {
      signal = 'NEUTRAL';
      filterReason = `Volatility ${volPercent.toFixed(1)}% ≥ ${this.options.volatilityThreshold}% threshold`;
    } else if (rawSignal === 'BULLISH' && regime === 'OVERBOUGHT') {
      signal = 'NEUTRAL';
      filterReason = `RSI Overbought (${rsiText} > ${strategy.rsiOverbought}) — CALL refused`;
    } else if (rawSignal === 'BEARISH' && regime === 'OVERSOLD') {
      signal = 'NEUTRAL';
      filterReason = `RSI Oversold (${rsiText} < ${strategy.rsiOversold}) — PUT refused`;
    } else if (rawSignal === 'NEUTRAL') {
      filterReason = 'Flat momentum';
    } else {
      const preferred: Direction = rawSignal === 'BULLISH' ? 'CALL' : 'PUT';
      const streakBlock = this.guard.check(preferred);
      if (!streakBlock.allowed) {
        // Preferred side is over its same-direction limit → rebalance to the
        // opposite side instead of stalling (keeps both CALL and PUT trading).
        const opposite = DirectionGuard.opposite(preferred);
        const rsiForbids =
          (opposite === 'CALL' && regime === 'OVERBOUGHT') || (opposite === 'PUT' && regime === 'OVERSOLD');
        const flip = this.guard.flipBlocked(opposite);
        if (rsiForbids) {
          signal = 'NEUTRAL';
          filterReason = `${streakBlock.reason} Rebalance to ${opposite} refused: RSI ${regime.toLowerCase()} (${rsiText})`;
        } else if (flip) {
          signal = 'NEUTRAL';
          filterReason = `${streakBlock.reason} NEUTRAL before rebalancing to ${opposite}`;
        } else {
          signal = opposite === 'CALL' ? 'BULLISH' : 'BEARISH';
          rebalance = `${streakBlock.reason} Rebalanced ${preferred} → ${opposite}`;
        }
      } else {
        const flip = this.guard.flipBlocked(preferred);
        if (flip) {
          signal = 'NEUTRAL';
          filterReason = flip;
        }
      }
    }
    const finalSignal: AiDecisionFeatures['finalSignal'] =
      signal === 'BULLISH' ? 'CALL' : signal === 'BEARISH' ? 'PUT' : 'NEUTRAL';
    this.guard.observeSignal(finalSignal);

    const streak = this.guard.streak();
    const features: AiDecisionFeatures = {
      currentPrice: round4(last),
      momentumPercent: round4(momentumPercent),
      momentumPeriod: this.options.momentumPeriod,
      rsi: rsiValue === null ? null : round4(rsiValue),
      rsiPeriod: strategy.rsiPeriod,
      rsiOverbought: strategy.rsiOverbought,
      rsiOversold: strategy.rsiOversold,
      volatilityPercent: round4(volPercent),
      volatilityThreshold: this.options.volatilityThreshold,
      regime,
      rawSignal,
      consecutivePutCount: streak.consecutivePutCount,
      consecutiveCallCount: streak.consecutiveCallCount,
      finalSignal,
      filterReason,
      rejectionReason: null,
      rebalanceReason: rebalance,
      marketSource: this.market.sourceName?.(symbol) ?? 'SIMULATED',
    };

    const indicators =
      `price ${last.toFixed(2)}, momentum ${momentumPercent.toFixed(2)}% (${this.options.momentumPeriod}c), ` +
      `RSI(${strategy.rsiPeriod}) ${rsiText}, vol ${volPercent.toFixed(1)}%, ` +
      `streak PUT ${streak.consecutivePutCount} / CALL ${streak.consecutiveCallCount}`;
    const rationale =
      signal === 'NEUTRAL'
        ? `NEUTRAL — ${filterReason ?? 'no edge'}: ${indicators}`
        : rebalance
          ? `${finalSignal} (rebalance) — ${rebalance}: ${indicators}`
          : `${finalSignal} — momentum ${momentumPercent > 0 ? 'up' : 'down'}, RSI in normal range: ${indicators}`;

    // A rebalance trade goes against momentum → minimum directional confidence.
    const confidence =
      signal === 'NEUTRAL'
        ? 0.5
        : rebalance
          ? 0.55
          : this.confidenceFor(Math.abs(momentumPercent), volPercent, rsiValue, strategy);
    const decision = logAiDecision({
      symbol,
      signal,
      action: SIGNAL_TO_ACTION[signal],
      confidence,
      expectedReturn: signal === 'NEUTRAL' || rebalance ? 0 : round4(momentumPercent / 100),
      proposedTradeSizeUsd: config.FIXED_TRADE_SIZE_USD,
      rationale,
      executed: false,
      positionId: null,
      features,
    });
    publishEvent('decision', decision);
    return decision;
  }

  /** Evaluates every configured symbol. */
  generateAll(): AiDecision[] {
    return this.market.getSymbols().map((symbol) => this.evaluate(symbol));
  }

  /**
   * Confidence: momentum strength + market calmness, reduced as RSI
   * approaches either extreme (a stretched market is more likely to revert).
   */
  private confidenceFor(
    absMomentumPercent: number,
    volPercent: number,
    rsiValue: number | null,
    strategy: { rsiOverbought: number; rsiOversold: number },
  ): number {
    const momentumScore = Math.min(absMomentumPercent / this.options.momentumSaturation, 1);
    const calmnessScore = Math.max(1 - volPercent / this.options.volatilityThreshold, 0);
    let stretchPenalty = 0;
    if (rsiValue !== null) {
      const mid = (strategy.rsiOverbought + strategy.rsiOversold) / 2;
      const halfRange = (strategy.rsiOverbought - strategy.rsiOversold) / 2;
      stretchPenalty = 0.1 * Math.min(Math.abs(rsiValue - mid) / halfRange, 1);
    }
    return round4(clamp(0.5 + 0.25 * momentumScore + 0.2 * calmnessScore - stretchPenalty, 0.5, 0.95));
  }
}
