import type {
  AddressSource,
  AddressValidation,
  WalletAddresses,
  WalletAddressesUpdate,
} from '@aioption/shared';

import { config } from '../config.js';
import { getAppSetting, setAppSetting } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { validateTronAddress } from './tronAddress.js';

/**
 * Phase 6.5.1 settings layer: values saved from the UI live in the
 * `app_settings` table and override the environment defaults.
 *
 * Storage map (single source of truth per value):
 *   app_settings.usdt_trade_address             ← TRON_DEPOSIT_ADDRESS (env default)
 *   app_settings.withdrawal_destination_address ← falls back to usdt_trade_address
 *   app_settings.trx_fee_wallet_address         ← TRON_FEE_WALLET_ADDRESS (env default)
 *   app_settings.classic_trading_enabled        (default true)
 *   app_settings.classic_default_stake_usd      ← DEFAULT_OPTION_STAKE_USD
 *   app_settings.total_loss_limit_percent       ← TOTAL_LOSS_LIMIT_PERCENT
 *   account.max_option_stake_usd                (classic max stake, pre-existing column)
 *   account.option_default_duration_seconds     (classic default duration, pre-existing)
 *   account.loss_limit_percent                  (daily loss limit, shared with binary)
 */
export const SETTING_KEYS = {
  usdtTradeAddress: 'usdt_trade_address',
  withdrawalDestinationAddress: 'withdrawal_destination_address',
  trxFeeWalletAddress: 'trx_fee_wallet_address',
  /** Phase 7.4: USDT TRC20 token contract override (DB wins over env). */
  usdtTokenContract: 'usdt_token_contract',
  classicTradingEnabled: 'classic_trading_enabled',
  classicDefaultStakeUsd: 'classic_default_stake_usd',
  totalLossLimitPercent: 'total_loss_limit_percent',
} as const;

/** Simulated placeholder addresses (SIMULATED Tron mode only). */
export const SIMULATED_DEPOSIT_ADDRESS = 'TSimulatedAiOptionDepositAddressUSDT1';
export const SIMULATED_FEE_WALLET_ADDRESS = 'TSimulatedFeeWalletAddressTRX0000000001';

/**
 * Reads a setting; returns null when unset OR when the DB is not initialized
 * (unit tests of pure services run without a database).
 */
export function readSetting(key: string): { value: string; updatedAt: string } | null {
  try {
    const row = getAppSetting(key);
    return row ? { value: row.value, updatedAt: row.updatedAt } : null;
  } catch {
    return null;
  }
}

export function readNumberSetting(key: string, fallback: number): number {
  const raw = readSetting(key)?.value;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readBoolSetting(key: string, fallback: boolean): boolean {
  const raw = readSetting(key)?.value;
  return raw === undefined ? fallback : raw === 'true';
}

/* -------------------------------- addresses -------------------------------- */

export interface ResolvedAddress {
  address: string;
  source: AddressSource;
  updatedAt: string | null;
}

/** USDT trade/deposit address: database → environment → simulated → not set. */
export function resolveUsdtTradeAddress(): ResolvedAddress {
  const stored = readSetting(SETTING_KEYS.usdtTradeAddress);
  if (stored) {
    return { address: stored.value, source: 'DATABASE', updatedAt: stored.updatedAt };
  }
  if (config.TRON_DEPOSIT_ADDRESS) {
    return { address: config.TRON_DEPOSIT_ADDRESS, source: 'ENVIRONMENT', updatedAt: null };
  }
  if (config.TRON_MODE === 'SIMULATED') {
    return { address: SIMULATED_DEPOSIT_ADDRESS, source: 'SIMULATED', updatedAt: null };
  }
  return { address: '', source: 'NOT_SET', updatedAt: null };
}

/**
 * USDT TRC20 token contract (Phase 7.4): database → environment → not set.
 * No simulated placeholder — a contract either exists on the configured
 * network or it doesn't.
 */
export function resolveUsdtTokenContract(): ResolvedAddress {
  const stored = readSetting(SETTING_KEYS.usdtTokenContract);
  if (stored) {
    return { address: stored.value, source: 'DATABASE', updatedAt: stored.updatedAt };
  }
  if (config.TRON_USDT_CONTRACT_ADDRESS) {
    return { address: config.TRON_USDT_CONTRACT_ADDRESS, source: 'ENVIRONMENT', updatedAt: null };
  }
  return { address: '', source: 'NOT_SET', updatedAt: null };
}

/** Optional explicit withdrawal destination (empty = use the trade address). */
export function resolveWithdrawalDestinationAddress(): ResolvedAddress {
  const stored = readSetting(SETTING_KEYS.withdrawalDestinationAddress);
  if (stored) {
    return { address: stored.value, source: 'DATABASE', updatedAt: stored.updatedAt };
  }
  return { address: '', source: 'NOT_SET', updatedAt: null };
}

/** TRX fee wallet: database → environment → simulated → trade address (live) → not set. */
export function resolveTrxFeeWalletAddress(): ResolvedAddress {
  const stored = readSetting(SETTING_KEYS.trxFeeWalletAddress);
  if (stored) {
    return { address: stored.value, source: 'DATABASE', updatedAt: stored.updatedAt };
  }
  if (config.TRON_FEE_WALLET_ADDRESS) {
    return { address: config.TRON_FEE_WALLET_ADDRESS, source: 'ENVIRONMENT', updatedAt: null };
  }
  if (config.TRON_MODE === 'SIMULATED') {
    return { address: SIMULATED_FEE_WALLET_ADDRESS, source: 'SIMULATED', updatedAt: null };
  }
  // Live mode without a dedicated fee wallet: the main address receives TRX.
  const trade = resolveUsdtTradeAddress();
  return trade.address ? { ...trade, updatedAt: null } : { address: '', source: 'NOT_SET', updatedAt: null };
}


function describeValidation(resolved: ResolvedAddress): AddressValidation {
  if (resolved.source === 'NOT_SET') {
    return { valid: false, addressType: 'UNKNOWN', reason: 'Not set.' };
  }
  if (resolved.source === 'SIMULATED') {
    return {
      valid: false,
      addressType: 'UNKNOWN',
      reason: 'Simulated placeholder — save your own Tron address.',
    };
  }
  return validateTronAddress(resolved.address);
}

/** Public view of all user-editable addresses. Never includes secrets. */
export function getWalletAddresses(): WalletAddresses {
  const trade = resolveUsdtTradeAddress();
  const withdrawal = resolveWithdrawalDestinationAddress();
  const fee = resolveTrxFeeWalletAddress();
  const updatedAt =
    [trade.updatedAt, withdrawal.updatedAt, fee.updatedAt]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
  return {
    usdtTradeAddress: trade.address,
    withdrawalDestinationAddress: withdrawal.address,
    effectiveWithdrawalDestinationAddress: withdrawal.address || trade.address,
    trxFeeWalletAddress: fee.address,
    usdtTradeAddressSource: trade.source,
    withdrawalDestinationAddressSource: withdrawal.source,
    trxFeeWalletAddressSource: fee.source,
    updatedAt,
    validationStatus: {
      usdtTradeAddress: describeValidation(trade),
      withdrawalDestinationAddress: withdrawal.address ? validateTronAddress(withdrawal.address) : null,
      trxFeeWalletAddress: describeValidation(fee),
    },
  };
}

export class AddressValidationError extends Error {
  constructor(
    readonly field: keyof WalletAddressesUpdate,
    readonly reason: string,
  ) {
    super(`Invalid ${field}: ${reason}`);
    this.name = 'AddressValidationError';
  }
}

/**
 * Validates EVERY provided address first, then saves them all (nothing is
 * written if any address is invalid). Empty string clears an override.
 * Each change is recorded in settings_audit.
 */
export function updateWalletAddresses(update: WalletAddressesUpdate): WalletAddresses {
  const fields: Array<[keyof WalletAddressesUpdate, string]> = [
    ['usdtTradeAddress', SETTING_KEYS.usdtTradeAddress],
    ['withdrawalDestinationAddress', SETTING_KEYS.withdrawalDestinationAddress],
    ['trxFeeWalletAddress', SETTING_KEYS.trxFeeWalletAddress],
  ];
  const pending: Array<[string, string]> = [];
  for (const [field, key] of fields) {
    const raw = update[field];
    if (raw === undefined) {
      continue;
    }
    const value = raw.trim();
    if (value !== '') {
      const result = validateTronAddress(value);
      if (!result.valid) {
        throw new AddressValidationError(field, result.reason ?? 'invalid Tron address');
      }
    }
    pending.push([key, value]);
  }
  for (const [key, value] of pending) {
    setAppSetting(key, value);
  }
  const addresses = getWalletAddresses();
  if (pending.length > 0) {
    publishEvent('settings', { action: 'ADDRESSES_UPDATED', addresses });
  }
  return addresses;
}
