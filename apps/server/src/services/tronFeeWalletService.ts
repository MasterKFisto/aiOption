import { randomUUID } from 'node:crypto';

import type { TrxFeeDepositInfo, TrxFeeStatus } from '@aioption/shared';

import { config } from '../config.js';
import {
  createTrxFeeDeposit,
  feeWalletTrxBalance,
  listTrxFeeDeposits,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { resolveTrxFeeWalletAddress, resolveUsdcTradeAddress } from './appSettings.js';
import { lastProbedResources } from './tronStatusService.js';

/**
 * The TRX fee wallet address: UI-saved value (Phase 6.5.1) → env →
 * simulated placeholder → main trade address (live mode).
 */
export function getFeeWalletAddress(): string {
  return resolveTrxFeeWalletAddress().address;
}

export function getFeeDepositInfo(): TrxFeeDepositInfo {
  const tradeAddress = resolveUsdcTradeAddress().address;
  const sameAddressAsDeposit = tradeAddress !== '' && getFeeWalletAddress() === tradeAddress;
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

/**
 * Fee reserve status. SIMULATED: balance from credited (simulated) TRX
 * deposits. Real networks (Phase 7): the on-chain balance from the last
 * successful probe, falling back to the internal ledger.
 */
export function getFeeReserveStatus(): TrxFeeStatus {
  const onChain = lastProbedResources();
  const trxBalance = onChain ? onChain.trxBalance : feeWalletTrxBalance();
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
    energyAvailable: config.TRON_MODE === 'SIMULATED' ? 100_000 : (onChain?.energyAvailable ?? 0),
    bandwidthAvailable: config.TRON_MODE === 'SIMULATED' ? 5_000 : (onChain?.bandwidthAvailable ?? 0),
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
