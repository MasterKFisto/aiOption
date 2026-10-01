import { roundMoney } from '@aioption/shared';

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
