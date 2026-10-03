/**
 * Phase 7.1 — currency constants. The base (accounting) currency is USDT on
 * the Tron network (TRC20). USDC is no longer supported on Tron; the server
 * refuses to start with BASE_CURRENCY=USDC and migrates old rows on startup.
 *
 * Frontend and backend must import these instead of hardcoding "USDT".
 */

/** Base currency label for balances, deposits, withdrawals and tickets. */
export const BASE_CURRENCY_LABEL = 'USDT';

/** TRC20 decimals for USDT (unchanged from USDC — also 6). */
export const BASE_CURRENCY_DECIMALS = 6;

/**
 * Testnet token: there is no official USDT on Shasta/Nile, so a test TRC20
 * token stands in. Clearly labelled; no real value.
 */
export const TESTNET_TOKEN_SYMBOL = 'USDT-TEST';
export const TESTNET_TOKEN_NAME = 'Tether USD Test';
export const TESTNET_TOKEN_DECIMALS = 6;

/** UI banner text shown while MODE=TESTNET. */
export const TESTNET_ASSET_NOTICE =
  'Testnet asset: USDT-TEST. This is a test token with no real value.';

/** Deposit warning shown next to the deposit address. */
export const TRON_DEPOSIT_WARNING =
  'Only USDT on the Tron network should be sent to this address. ' +
  'Other networks or assets may result in permanent loss.';
