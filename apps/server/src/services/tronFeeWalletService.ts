import { randomUUID } from 'node:crypto';

import type { TrxFeeDepositInfo, TrxFeeStatus } from '@aioption/shared';

import { config } from '../config.js';
import {
  createTrxFeeDeposit,
  feeWalletTrxBalance,
  listTrxFeeDeposits,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { SIMULATED_DEPOSIT_ADDRESS } from './tronService.js';

const SIMULATED_FEE_WALLET_ADDRESS = 'TSimulatedFeeWalletAddressTRX0000000001';

/** The TRX fee wallet address (dedicated config or the main deposit address). */
export function getFeeWalletAddress(): string {
  if (config.TRON_FEE_WALLET_ADDRESS) {
    return config.TRON_FEE_WALLET_ADDRESS;
  }
  if (config.TRON_MODE === 'SIMULATED') {
    return SIMULATED_FEE_WALLET_ADDRESS;
  }
  return config.TRON_DEPOSIT_ADDRESS || SIMULATED_DEPOSIT_ADDRESS;
}

export function getFeeDepositInfo(): TrxFeeDepositInfo {
  const sameAddressAsDeposit = getFeeWalletAddress() === (config.TRON_DEPOSIT_ADDRESS || SIMULATED_DEPOSIT_ADDRESS);
  return {
    feeWalletAddress: getFeeWalletAddress(),
    sameAddressAsDeposit,
    asset: 'TRX',
    network: 'TRON',
    purpose: 'network fee reserve',
    acceptTrxDeposits: config.TRON_ACCEPT_TRX_DEPOSITS,
    requiredConfirmations: config.TRON_FEE_DEPOSIT_REQUIRED_CONFIRMATIONS,
    warning:
      'TRX deposits are used only for Tron network fees. They are not credited as USDC trading balance.',
  };
}

/** Fee reserve status: simulated balance from credited TRX deposits. */
export function getFeeReserveStatus(): TrxFeeStatus {
  const trxBalance = feeWalletTrxBalance();
  const sufficient = trxBalance >= config.TRON_MIN_TRX_FEE_RESERVE;
  const estimatedWithdrawalsSupported = Math.floor(trxBalance / config.TRON_WITHDRAWAL_FEE_ESTIMATE_TRX);
  const warnings: string[] = [];
  if (!sufficient) {
    warnings.push(
      `TRX fee reserve (${trxBalance}) is below the ${config.TRON_MIN_TRX_FEE_RESERVE} minimum — fund the fee wallet with TRX before withdrawing USDC`,
    );
  }
  if (!config.TRON_ACCEPT_TRX_DEPOSITS) {
    warnings.push('TRX fee deposits are disabled by configuration');
  }
  return {
    feeWalletAddress: getFeeWalletAddress(),
    trxBalance,
    energyAvailable: config.TRON_MODE === 'SIMULATED' ? 100_000 : 0,
    bandwidthAvailable: config.TRON_MODE === 'SIMULATED' ? 5_000 : 0,
    minTrxFeeReserve: config.TRON_MIN_TRX_FEE_RESERVE,
    sufficientFeeReserve: sufficient,
    estimatedWithdrawalsSupported: Math.max(0, estimatedWithdrawalsSupported),
    lastCheckedAt: new Date().toISOString(),
    warnings,
  };
}

/** Native TRX transfers into the fee wallet (live modes: not detected yet). */
export async function getIncomingTrxTransfers(): Promise<never[]> {
  // Real-chain native TRX detection is not implemented; deposits arrive via
  // the simulated endpoint or are recorded by the operator manually.
  return [];
}

/** Simulated TRX fee deposit — updates the internal fee reserve accounting. */
export function simulateTrxDeposit(amountTrx: number, fromAddress?: string): TrxFeeStatus {
  const deposit = createTrxFeeDeposit({
    amountTrx,
    fromAddress: fromAddress ?? 'TSimulatedSenderAddress000000000000',
    txid: `sim-trx-${randomUUID()}`,
    status: 'CREDITED',
    confirmations: 999,
    creditedAt: new Date().toISOString(),
    notes: 'simulated TRX fee deposit',
  });
  publishEvent('tron', {
    action: 'FEE_DEPOSIT',
    deposit,
    status: getFeeReserveStatus(),
  });
  return getFeeReserveStatus();
}

export function getTrxFeeDeposits(limit = 50) {
  return listTrxFeeDeposits(limit);
}
