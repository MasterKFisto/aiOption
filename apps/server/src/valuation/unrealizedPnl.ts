import { roundMoney } from '@aioption/shared';
import type {
  BinaryContract,
  BinaryLiveStatus,
  BinaryUnrealizedMode,
  Position,
} from '@aioption/shared';

import { listOpenBinaryContracts } from '../binary/binaryRepository.js';
import { config } from '../config.js';
import { listPositions, positionStake } from '../db/repositories.js';
import { readBoolSetting } from '../services/appSettings.js';

/**
 * Unrealized PnL policy (Phase 6.5.3)
 * ===================================
 *
 * CLASSIC options — live, bounded mark-to-market:
 *   A classic option pays stake × (1 + payout) if it finishes in the money and
 *   0 otherwise. Before expiry its value is estimated from the probability of
 *   finishing in the money under a driftless lognormal model:
 *
 *     d             = ln(S / K) / (σ · √τ)      (sign flipped for PUT)
 *     P(win)        = Φ(d)
 *     value         = stake · (1 + payout) · P(win)
 *     unrealizedPnl = value − stake
 *
 *   Bounded by construction: −stake ≤ PnL ≤ stake · payout (the configured
 *   maximum loss / maximum profit). It depends on entry price K, current
 *   price S, side, stake and remaining time τ, and converges to the actual
 *   settlement outcome as τ → 0. After settlement the position is CLOSED and
 *   contributes 0.
 *
 * BINARY options — conservative by default:
 *   Unrealized PnL = 0 until settlement; the locked stake is reported as
 *   "Open Binary Exposure". Each contract still exposes a live status
 *   (WINNING / LOSING / FLAT), time remaining, potential profit and loss.
 *   With binary_show_estimated_unrealized_pnl = true an ESTIMATED binary PnL
 *   (same model) is reported separately — never mixed into unrealized or
 *   realized PnL.
 */

/** Classic payout ratio (must match OptionService.OPTION_PAYOUT_RATIO). */
export const CLASSIC_PAYOUT_RATIO = 0.8;
/** Annualized volatility assumption for the estimate (BTC ≈ 50–60%). */
const ANNUAL_VOLATILITY = 0.55;
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const SIGMA_PER_SQRT_SECOND = ANNUAL_VOLATILITY / Math.sqrt(SECONDS_PER_YEAR);

export const BINARY_ESTIMATE_SETTING_KEY = 'binary_show_estimated_unrealized_pnl';

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 7.5e-8). */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) {
    return x > 0 ? 1 : 0;
  }
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/** Probability that a CALL/UP (bullish) or PUT/DOWN finishes in the money. */
export function winProbability(
  bullish: boolean,
  currentPrice: number,
  strike: number,
  secondsRemaining: number,
): number {
  if (!(currentPrice > 0) || !(strike > 0)) {
    return 0.5;
  }
  const logMoneyness = Math.log(currentPrice / strike) * (bullish ? 1 : -1);
  if (secondsRemaining <= 0) {
    return logMoneyness > 0 ? 1 : logMoneyness < 0 ? 0 : 0.5;
  }
  return normalCdf(logMoneyness / (SIGMA_PER_SQRT_SECOND * Math.sqrt(secondsRemaining)));
}

/** Estimated PnL of a digital option, bounded to [−stake, +stake × payout]. */
export function estimateDigitalPnl(input: {
  bullish: boolean;
  stake: number;
  payoutRatio: number;
  entryPrice: number;
  currentPrice: number;
  secondsRemaining: number;
}): number {
  const { stake, payoutRatio } = input;
  if (!(stake > 0) || !(input.currentPrice > 0) || !(input.entryPrice > 0)) {
    return 0;
  }
  const p = winProbability(input.bullish, input.currentPrice, input.entryPrice, input.secondsRemaining);
  const pnl = stake * (1 + payoutRatio) * p - stake;
  return roundMoney(Math.min(stake * payoutRatio, Math.max(-stake, pnl)));
}

/** Live WINNING / LOSING / FLAT status of a binary contract. */
export function binaryLiveStatus(
  direction: BinaryContract['direction'],
  entryPrice: number,
  currentPrice: number,
): BinaryLiveStatus {
  if (!(currentPrice > 0) || currentPrice === entryPrice) {
    return 'FLAT';
  }
  const up = currentPrice > entryPrice;
  return (direction === 'UP') === up ? 'WINNING' : 'LOSING';
}

/** Binary unrealized mode: app_settings (UI) override → env default. */
export function binaryUnrealizedMode(): BinaryUnrealizedMode {
  return readBoolSetting(BINARY_ESTIMATE_SETTING_KEY, config.BINARY_SHOW_ESTIMATED_UNREALIZED_PNL)
    ? 'ESTIMATED'
    : 'CONSERVATIVE';
}

const secondsUntil = (expiresAt: string | null, nowMs: number): number => {
  const ms = expiresAt ? new Date(expiresAt).getTime() - nowMs : 0;
  return Number.isFinite(ms) ? Math.max(0, ms / 1000) : 0;
};

/** Live valuation of one OPEN classic position (0 when closed / no price). */
export function classicUnrealizedPnl(position: Position, currentPrice: number, nowMs = Date.now()): number {
  if (position.status !== 'OPEN' || !(currentPrice > 0)) {
    return 0;
  }
  return estimateDigitalPnl({
    bullish: position.side === 'CALL',
    stake: positionStake(position),
    payoutRatio: CLASSIC_PAYOUT_RATIO,
    entryPrice: position.strikePrice,
    currentPrice,
    secondsRemaining: secondsUntil(position.expiresAt, nowMs),
  });
}

export interface BinaryLiveView {
  currentStatus: BinaryLiveStatus;
  currentPrice: number;
  timeRemainingMs: number;
  potentialProfit: number;
  potentialLoss: number;
  estimatedUnrealizedPnl: number | null;
}

/** Live view of one OPEN binary contract (no final PnL before settlement). */
export function binaryLiveView(
  contract: BinaryContract,
  currentPrice: number,
  mode: BinaryUnrealizedMode,
  nowMs = Date.now(),
): BinaryLiveView {
  const timeRemainingMs = Math.max(0, new Date(contract.expiresAt).getTime() - nowMs);
  const estimate =
    mode === 'ESTIMATED' && currentPrice > 0
      ? estimateDigitalPnl({
          bullish: contract.direction === 'UP',
          stake: contract.stakeUsd,
          payoutRatio: contract.payoutRatio,
          entryPrice: contract.entryPrice,
          currentPrice,
          secondsRemaining: timeRemainingMs / 1000,
        })
      : null;
  return {
    currentStatus: binaryLiveStatus(contract.direction, contract.entryPrice, currentPrice),
    currentPrice,
    timeRemainingMs,
    potentialProfit: roundMoney(contract.potentialProfitUsd),
    potentialLoss: roundMoney(contract.stakeUsd),
    estimatedUnrealizedPnl: estimate,
  };
}

export interface PortfolioUnrealized {
  /** = openClassicUnrealizedPnl — binary estimates are NEVER included. */
  unrealizedPnl: number;
  openClassicUnrealizedPnl: number;
  openBinaryExposure: number;
  openBinaryCount: number;
  estimatedBinaryUnrealizedPnl: number | null;
  binaryUnrealizedMode: BinaryUnrealizedMode;
}

/** Portfolio-level unrealized figures for the account summary. */
export function portfolioUnrealized(currentPrice: number, nowMs = Date.now()): PortfolioUnrealized {
  const mode = binaryUnrealizedMode();
  const classic = listPositions('OPEN').reduce(
    (sum, position) => sum + classicUnrealizedPnl(position, currentPrice, nowMs),
    0,
  );
  const binary = listOpenBinaryContracts();
  const exposure = binary.reduce((sum, contract) => sum + contract.stakeUsd, 0);
  const estimated =
    mode === 'ESTIMATED'
      ? roundMoney(
          binary.reduce(
            (sum, contract) =>
              sum + (binaryLiveView(contract, currentPrice, mode, nowMs).estimatedUnrealizedPnl ?? 0),
            0,
          ),
        )
      : null;
  const openClassicUnrealizedPnl = roundMoney(classic);
  return {
    unrealizedPnl: openClassicUnrealizedPnl,
    openClassicUnrealizedPnl,
    openBinaryExposure: roundMoney(exposure),
    openBinaryCount: binary.length,
    estimatedBinaryUnrealizedPnl: estimated,
    binaryUnrealizedMode: mode,
  };
}

