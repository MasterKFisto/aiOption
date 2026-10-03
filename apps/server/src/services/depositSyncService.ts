import { roundMoney } from '@aioption/shared';
import { randomUUID } from 'node:crypto';

import { createDeposit } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { logger } from '../logger.js';
import { tronService } from './tronService.js';
import { WalletService } from './walletService.js';

let lastSyncedAt: string | null = null;
let timer: NodeJS.Timeout | null = null;

export function getLastSyncedAt(): string | null {
  return lastSyncedAt;
}

/**
 * Pulls incoming USDC transfers from the Tron service and credits new ones.
 * Idempotency: deposits carry a UNIQUE txid, so re-syncing the same transfer
 * is a no-op (never credited twice).
 */
export async function syncDepositsOnce(): Promise<number> {
  let credited = 0;
  try {
    const transfers = await tronService.getIncomingUsdcTransfers();
    const wallet = new WalletService();
    for (const transfer of transfers) {
      const amount = roundMoney(transfer.amountUsdc);
      const deposit = createDeposit({
        amount,
        fromAddress: transfer.fromAddress,
        txid: transfer.txid,
        status: 'CONFIRMED',
        confirmations: transfer.confirmations,
        creditedAt: new Date().toISOString(),
        notes: 'Tron USDC TRC20 deposit',
      });
      if (!deposit) {
        continue; // duplicate txid — already credited
      }
      wallet.deposit(amount, `Tron USDC deposit ${transfer.txid}`);
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
 * Phase 7: credits a SIMULATED USDC deposit straight onto the internal ledger
 * without going through a Tron service. Used by /deposits/simulate in TESTNET
 * mode, where the active TronGrid service watches a real test network and has
 * no simulation method. The route gate (config.SIMULATION_ALLOWED) guarantees
 * this can never run in LIVE mode.
 */
export function recordSimulatedDeposit(amountUsdc: number): boolean {
  const amount = roundMoney(amountUsdc);
  const txid = `sim-${randomUUID()}`;
  const deposit = createDeposit({
    amount,
    fromAddress: 'TSimulatedSenderAddress000000000000',
    txid,
    status: 'CONFIRMED',
    confirmations: 999,
    creditedAt: new Date().toISOString(),
    notes: 'simulated Tron USDC TRC20 deposit (test ledger)',
  });
  if (!deposit) {
    return false;
  }
  new WalletService().deposit(amount, `Simulated Tron USDC deposit ${txid}`);
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
