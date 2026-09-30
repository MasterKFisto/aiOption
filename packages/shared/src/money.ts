/** Rounds a monetary amount to a sane number of decimals (default 2). */
export function roundMoney(amount: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}
