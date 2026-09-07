/**
 * Safe decimal arithmetic using string representation to avoid floating-point issues.
 * All monetary values should use these helpers.
 */

/**
 * Adds two decimal strings
 */
export function addDec(a: string, b: string): string {
  const factor = 1_000_000;
  const result = (Math.round(parseFloat(a) * factor) + Math.round(parseFloat(b) * factor)) / factor;
  return result.toFixed(6);
}

/**
 * Subtracts b from a (decimal strings)
 */
export function subDec(a: string, b: string): string {
  const factor = 1_000_000;
  const result = (Math.round(parseFloat(a) * factor) - Math.round(parseFloat(b) * factor)) / factor;
  return result.toFixed(6);
}

/**
 * Multiplies two decimal strings
 */
export function mulDec(a: string, b: string): string {
  const factor = 1_000_000;
  const result = (Math.round(parseFloat(a) * factor) * parseFloat(b)) / factor;
  return result.toFixed(6);
}

/**
 * Divides a by b (decimal strings)
 */
export function divDec(a: string, b: string): string {
  if (parseFloat(b) === 0) return '0.000000';
  const result = parseFloat(a) / parseFloat(b);
  return result.toFixed(6);
}

/**
 * Checks if a > b
 */
export function gtDec(a: string, b: string): boolean {
  return parseFloat(a) > parseFloat(b);
}

/**
 * Checks if a >= b
 */
export function gteDec(a: string, b: string): boolean {
  return parseFloat(a) >= parseFloat(b);
}

/**
 * Checks if a < b
 */
export function ltDec(a: string, b: string): boolean {
  return parseFloat(a) < parseFloat(b);
}

/**
 * Checks if a <= b
 */
export function lteDec(a: string, b: string): boolean {
  return parseFloat(a) <= parseFloat(b);
}

/**
 * Checks if a === b
 */
export function eqDec(a: string, b: string): boolean {
  return parseFloat(a) === parseFloat(b);
}

/**
 * Formats a decimal string for display
 */
export function formatDec(value: string, decimals = 2): string {
  return parseFloat(value).toFixed(decimals);
}

/**
 * Checks if value is zero
 */
export function isZero(value: string): boolean {
  return parseFloat(value) === 0;
}