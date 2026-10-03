import { describe, expect, it } from 'vitest';

import { momentumPercent, rsi } from '../src/strategy/indicators.js';

describe('RSI (Wilder)', () => {
  it('matches the classic Wilder reference example (StockCharts: 70.53 → 66.32)', () => {
    // Reference closes from the StockCharts RSI worked example. The source
    // table rounds intermediate averages, so allow ±0.1 against it.
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
    ];
    expect(Math.abs(rsi(closes.slice(0, 15), 14)! - 70.53)).toBeLessThan(0.1);
    expect(Math.abs(rsi(closes.slice(0, 16), 14)! - 66.32)).toBeLessThan(0.1);
    // Exact seed step: gains 3.34 / 14 = 0.238571…, losses 1.40 / 14 = 0.10.
    expect(rsi(closes.slice(0, 15), 14)!).toBeCloseTo(100 - 100 / (1 + 3.34 / 1.4), 6);
  });

  it('handles extremes: all gains → 100, all losses → 0, flat → 50', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(up, 14)).toBe(100);
    expect(rsi(down, 14)).toBe(0);
    expect(rsi(Array(30).fill(100), 14)).toBe(50);
  });

  it('returns null without enough data and rejects invalid periods', () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
    expect(() => rsi([1, 2, 3], 0)).toThrow(/positive integer/);
  });

  it('stays within [0, 100]', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const closes = Array.from({ length: 200 }, () => 100 + rand() * 10);
    const value = rsi(closes, 14)!;
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });
});

describe('momentumPercent', () => {
  it('computes the % change over the period', () => {
    expect(momentumPercent([100, 101, 102, 110], 3)).toBeCloseTo(10, 6);
    expect(momentumPercent([100, 90], 1)).toBeCloseTo(-10, 6);
    expect(momentumPercent([100], 1)).toBeNull();
  });
});
