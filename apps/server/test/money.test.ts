import { describe, expect, it } from 'vitest';

import { roundMoney } from '@aioption/shared';

describe('roundMoney', () => {
  it('rounds to 2 decimals by default, half away from zero', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(1.999)).toBe(2);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });

  it('supports custom decimals', () => {
    expect(roundMoney(1.23456, 3)).toBe(1.235);
    expect(roundMoney(1.23456, 0)).toBe(1);
  });

  it('handles zero', () => {
    expect(roundMoney(0)).toBe(0);
  });
});
