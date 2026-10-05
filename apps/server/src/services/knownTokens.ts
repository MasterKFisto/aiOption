/**
 * Phase 7.4: well-known MAINNET TRC20 token contracts. Used only to WARN when
 * one is configured on a test network — never as an active default. Kept in a
 * dependency-free module so config.ts and the token service can both import it
 * without an import cycle.
 */
export const KNOWN_MAINNET_TOKENS: Readonly<Record<string, string>> = {
  // Mainnet USDT (TRC20) — reference only; verify independently before any
  // mainnet use. Never valid on Shasta/Nile.
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: 'USDT (Tron mainnet)',
};

/** True when the address is a known mainnet token contract. */
export function isKnownMainnetToken(address: string): boolean {
  return Object.prototype.hasOwnProperty.call(KNOWN_MAINNET_TOKENS, address);
}
