import type { AiBinarySignal, PriceTick } from '@aioption/shared';

import type { AiSignalResult } from './binaryAiTypes.js';

/** Deterministic short-term signal generator (replaceable by an ML model later). */
export function generateAiSignal(
  ticks: PriceTick[],
  nowMs: number,
  maxStaleMs: number,
): AiSignalResult {
  const neutral = (reason: string): AiSignalResult => ({
    timestamp: new Date(nowMs).toISOString(),
    asset: 'BTC/USDT',
    signal: 'NEUTRAL',
    confidence: 0.5,
    reason,
    features: {},
  });

  if (ticks.length < 10) {
    return neutral('not enough market data yet');
  }
  const latest = ticks[ticks.length - 1]!;
  const ageMs = nowMs - new Date(latest.timestamp).getTime();
  if (ageMs > maxStaleMs) {
    return neutral(`market data stale (${Math.round(ageMs)}ms)`);
  }

  const prices = ticks.map((tick) => tick.price);
  const last = prices[prices.length - 1]!;

  // Momentum over fixed windows (percent).
  const momentum = (windowMs: number): number => {
    const target = nowMs - windowMs;
    let best: PriceTick | null = null;
    for (const tick of ticks) {
      if (new Date(tick.timestamp).getTime() <= target) {
        best = tick;
      }
    }
    const base = best ?? ticks[0]!;
    return ((last - base.price) / base.price) * 100;
  };
  const m1 = momentum(1000);
  const m3 = momentum(3000);
  const m5 = momentum(5000);
  const m10 = momentum(10000);

  // Short/long EMA direction.
  const ema = (period: number): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [];
    for (const price of prices) {
      out.push(out.length === 0 ? price : price * k + out[out.length - 1]! * (1 - k));
    }
    return out;
  };
  const emaShort = ema(4).at(-1)!;
  const emaLong = ema(12).at(-1)!;
  const emaUp = emaShort > emaLong;

  // 1-tick return volatility (percent).
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(((prices[i]! - prices[i - 1]!) / prices[i - 1]!) * 100);
  }
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);

  const features = {
    momentum1s: Number(m1.toFixed(5)),
    momentum3s: Number(m3.toFixed(5)),
    momentum5s: Number(m5.toFixed(5)),
    momentum10s: Number(m10.toFixed(5)),
    volatilityPercent: Number(volatility.toFixed(5)),
    emaDirection: emaUp ? 1 : -1,
  };

  const VOLATILITY_CAP = 0.2; // percent per tick
  const MIN_MOMENTUM = 0.01; // percent over the 5s window
  const consistent =
    Math.sign(m1) === Math.sign(m3) && Math.sign(m3) === Math.sign(m5) && m5 !== 0;
  const emaAligned = (m5 > 0 && emaUp) || (m5 < 0 && !emaUp);

  if (volatility > VOLATILITY_CAP) {
    return { ...neutral('volatility too high to trade'), features };
  }
  if (Math.abs(m5) < MIN_MOMENTUM) {
    return { ...neutral('market flat'), features };
  }

  const signal: AiBinarySignal = m5 > 0 ? 'UP' : 'DOWN';
  const strength = Math.min(Math.abs(m5) / 0.05, 1); // saturate at 0.05%
  const confidence = Math.min(
    0.5 + 0.15 * strength + (consistent ? 0.15 : 0) + (emaAligned ? 0.1 : 0),
    0.95,
  );

  if (!consistent && !emaAligned) {
    return {
      timestamp: new Date(nowMs).toISOString(),
      asset: 'BTC/USDT',
      signal: 'NEUTRAL',
      confidence: 0.5,
      reason: 'momentum and EMA disagree',
      features,
    };
  }

  return {
    timestamp: new Date(nowMs).toISOString(),
    asset: 'BTC/USDT',
    signal,
    confidence: Number(confidence.toFixed(4)),
    reason: `momentum ${m5 >= 0 ? '+' : ''}${m5.toFixed(4)}% over 5s, volatility ${volatility.toFixed(4)}%`,
    features,
  };
}
