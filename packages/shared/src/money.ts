/** Rounds a monetary amount to a sane number of decimals (default 2), half away from zero. */
export function roundMoney(amount: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const rounded =
    amount >= 0
      ? Math.round((amount + Number.EPSILON) * factor)
      : -Math.round((-amount + Number.EPSILON) * factor);
  return rounded / factor;
}
