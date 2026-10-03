import { describe, expect, it } from 'vitest';

import {
  binaryLiveStatus,
  binaryLiveView,
  estimateDigitalPnl,
  normalCdf,
  winProbability,
} from '../src/valuation/unrealizedPnl.js';

const base = { stake: 10, payoutRatio: 0.8, entryPrice: 60_000 };

describe('valuation math (Phase 6.5.3)', () => {
  it('normalCdf matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('win probability: at-the-money = 50%, CALL/PUT symmetric, sharpens as time runs out', () => {
    expect(winProbability(true, 60_000, 60_000, 600)).toBeCloseTo(0.5, 6);
    const call = winProbability(true, 60_100, 60_000, 600);
    const put = winProbability(false, 60_100, 60_000, 600);
    expect(call).toBeGreaterThan(0.5);
    expect(call + put).toBeCloseTo(1, 6);
    expect(winProbability(true, 60_100, 60_000, 10)).toBeGreaterThan(call);
    expect(winProbability(true, 60_100, 60_000, 0)).toBe(1);
    expect(winProbability(false, 60_100, 60_000, 0)).toBe(0);
  });

  it('classic estimate depends on entry, current price, side and remaining time', () => {
    const winningCall = estimateDigitalPnl({ ...base, bullish: true, currentPrice: 60_200, secondsRemaining: 300 });
    const losingCall = estimateDigitalPnl({ ...base, bullish: true, currentPrice: 59_800, secondsRemaining: 300 });
    const winningPut = estimateDigitalPnl({ ...base, bullish: false, currentPrice: 59_800, secondsRemaining: 300 });
    expect(winningCall).toBeGreaterThan(0);
    expect(losingCall).toBeLessThan(0);
    expect(winningPut).toBeCloseTo(winningCall, 1); // symmetric
    // At the money the value is slightly below the stake (house edge 0.8 payout).
    expect(estimateDigitalPnl({ ...base, bullish: true, currentPrice: 60_000, secondsRemaining: 300 })).toBe(-1);
  });

  it('is bounded: loss never exceeds the stake, profit never exceeds stake × payout', () => {
    for (const currentPrice of [1, 30_000, 59_999, 60_001, 90_000, 1e9]) {
      for (const secondsRemaining of [0, 1, 60, 3600, 1e9]) {
        for (const bullish of [true, false]) {
          const pnl = estimateDigitalPnl({ ...base, bullish, currentPrice, secondsRemaining });
          expect(pnl).toBeGreaterThanOrEqual(-10);
          expect(pnl).toBeLessThanOrEqual(8);
        }
      }
    }
    // Deep in the money at expiry → exactly the max profit; out → exactly −stake.
    expect(estimateDigitalPnl({ ...base, bullish: true, currentPrice: 61_000, secondsRemaining: 0 })).toBe(8);
    expect(estimateDigitalPnl({ ...base, bullish: true, currentPrice: 59_000, secondsRemaining: 0 })).toBe(-10);
  });

  it('returns 0 for invalid inputs (no price yet, zero stake)', () => {
    expect(estimateDigitalPnl({ ...base, bullish: true, currentPrice: 0, secondsRemaining: 60 })).toBe(0);
    expect(estimateDigitalPnl({ ...base, stake: 0, bullish: true, currentPrice: 60_100, secondsRemaining: 60 })).toBe(0);
    expect(estimateDigitalPnl({ ...base, bullish: true, currentPrice: Number.NaN, secondsRemaining: 60 })).toBe(0);
  });
});

describe('binary live status (Phase 6.5.3)', () => {
  it('UP: above entry = WINNING, below = LOSING, equal = FLAT', () => {
    expect(binaryLiveStatus('UP', 100, 101)).toBe('WINNING');
    expect(binaryLiveStatus('UP', 100, 99)).toBe('LOSING');
    expect(binaryLiveStatus('UP', 100, 100)).toBe('FLAT');
  });

  it('DOWN: below entry = WINNING, above = LOSING, equal = FLAT', () => {
    expect(binaryLiveStatus('DOWN', 100, 99)).toBe('WINNING');
    expect(binaryLiveStatus('DOWN', 100, 101)).toBe('LOSING');
    expect(binaryLiveStatus('DOWN', 100, 100)).toBe('FLAT');
  });

  it('no price yet → FLAT (never implies a result)', () => {
    expect(binaryLiveStatus('UP', 100, 0)).toBe('FLAT');
  });

  it('live view: potential profit/loss, countdown, estimate only in ESTIMATED mode', () => {
    const now = Date.now();
    const contract = {
      id: 1, asset: 'BTC/USDT', direction: 'UP' as const, stakeUsd: 10, payoutRatio: 0.8,
      potentialProfitUsd: 8, totalReturnIfWinUsd: 18, entryPrice: 100, settlementPrice: null,
      status: 'OPEN' as const, result: null, openedAt: new Date(now - 2000).toISOString(),
      expiresAt: new Date(now + 3000).toISOString(), settledAt: null, marketDataSource: null,
      source: 'AI_BINARY', rejectionReason: null, notes: null,
    };
    const conservative = binaryLiveView(contract as never, 101, 'CONSERVATIVE', now);
    expect(conservative).toMatchObject({
      currentStatus: 'WINNING', currentPrice: 101, timeRemainingMs: 3000,
      potentialProfit: 8, potentialLoss: 10, estimatedUnrealizedPnl: null,
    });
    const estimated = binaryLiveView(contract as never, 101, 'ESTIMATED', now);
    expect(estimated.estimatedUnrealizedPnl).not.toBeNull();
    expect(estimated.estimatedUnrealizedPnl!).toBeGreaterThan(0);
    expect(estimated.estimatedUnrealizedPnl!).toBeLessThanOrEqual(8);
  });
});
