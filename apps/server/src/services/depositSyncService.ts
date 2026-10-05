import { roundMoney } from '@aioption/shared';
import { randomUUID } from 'node:crypto';

import { createDeposit } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { logger } from '../logger.js';
import { resolveUsdtTokenContract } from './appSettings.js';
import { tronService } from './tronService.js';
import { WalletService } from './walletService.js';

let lastSyncedAt: string | null = null;
let timer: NodeJS.Timeout | null = null;

export function getLastSyncedAt(): string | null {
  return lastSyncedAt;
}

/**
 * Pulls incoming USDT transfers from the Tron service and credits new ones.
 * Idempotency: deposits carry a UNIQUE txid, so re-syncing the same transfer
 * is a no-op (never credited twice).
 *
 * Phase 7.4: only transfers from the CONFIGURED token contract are credited.
 * A transfer tagged with any other contract is skipped (never credited) and
 * logged — deposits from unrecognized token contracts are not USDT.
 */
export async function syncDepositsOnce(): Promise<number> {
  let credited = 0;
  try {
    const transfers = await tronService.getIncomingUsdtTransfers();
    const configuredContract = resolveUsdtTokenContract().address || null;
    const wallet = new WalletService();
    for (const transfer of transfers) {
      if (
        configuredContract !== null &&
        transfer.contractAddress !== null &&
        transfer.contractAddress !== configuredContract
      ) {
        logger.warn(
          { txid: transfer.txid, contract: transfer.contractAddress, configuredContract },
          'deposit skipped: transfer from an unrecognized token contract (not credited)',
        );
        continue;
      }
      const amount = roundMoney(transfer.amountUsdt);
      const deposit = createDeposit({
        amount,
        fromAddress: transfer.fromAddress,
        txid: transfer.txid,
        tokenContractAddress: transfer.contractAddress ?? configuredContract,
        status: 'CONFIRMED',
        confirmations: transfer.confirmations,
        creditedAt: new Date().toISOString(),
        notes: 'Tron USDT TRC20 deposit',
      });
      if (!deposit) {
        continue; // duplicate txid — already credited
      }
      wallet.deposit(amount, `Tron USDT deposit ${transfer.txid}`);
      publishEvent('deposit', deposit);
      credited++;
    }
    lastSyncedAt = new Date().toISOString();
  } catch (err) {
    logger.error({ err }, 'deposit sync failed');
  }
  return credited;
}

/**
 * Phase 7: credits a SIMULATED USDT deposit straight onto the internal ledger
 * without going through a Tron service. Used by /deposits/simulate in TESTNET
 * mode, where the active TronGrid service watches a real test network and has
 * no simulation method. The route gate (config.SIMULATION_ALLOWED) guarantees
 * this can never run in LIVE mode.
 */
export function recordSimulatedDeposit(amountUsdt: number): boolean {
  const amount = roundMoney(amountUsdt);
  const txid = `sim-${randomUUID()}`;
  const deposit = createDeposit({
    amount,
    fromAddress: 'TSimulatedSenderAddress000000000000',
    txid,
    tokenContractAddress: resolveUsdtTokenContract().address || null,
    status: 'CONFIRMED',
    confirmations: 999,
    creditedAt: new Date().toISOString(),
    notes: 'simulated Tron USDT TRC20 deposit (test ledger)',
  });
  if (!deposit) {
    return false;
  }
  new WalletService().deposit(amount, `Simulated Tron USDT deposit ${txid}`);
  publishEvent('deposit', deposit);
  return true;
}

export function startDepositSync(intervalMs = 10_000): void {
  if (timer) {
    return;
  }
  void syncDepositsOnce();
  timer = setInterval(() => {
    void syncDepositsOnce();
  }, intervalMs);
}

export function stopDepositSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
