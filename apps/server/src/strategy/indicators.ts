/**
 * Native technical indicators (Phase 6.5.2) — no third-party dependency.
 */

/**
 * Relative Strength Index with Wilder's smoothing.
 *
 *   1. changes  = close[i] - close[i-1]
 *   2. seed     = simple average of the first `period` gains / losses
 *   3. smoothing: avg = (prevAvg * (period - 1) + current) / period
 *   4. RSI      = 100 - 100 / (1 + avgGain / avgLoss)
 *
 * Edge cases: no losses → 100, no gains → 0, no movement at all → 50.
 * Returns null when fewer than `period + 1` closes are available.
 */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`RSI period must be a positive integer, got ${period}`);
  }
  if (closes.length < period + 1) {
    return null;
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgGain === 0 && avgLoss === 0) {
    return 50;
  }
  if (avgLoss === 0) {
    return 100;
  }
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** % change between the close `period` candles ago and the latest close. */
export function momentumPercent(closes: readonly number[], period: number): number | null {
  if (closes.length < period + 1) {
    return null;
  }
  const last = closes[closes.length - 1]!;
  const first = closes[closes.length - 1 - period]!;
  return ((last - first) / first) * 100;
}
