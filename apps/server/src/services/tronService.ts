import { randomUUID } from 'node:crypto';

import { config } from '../config.js';
import { SIMULATED_DEPOSIT_ADDRESS, resolveUsdtTradeAddress } from './appSettings.js';
import { TronGridTronService } from './tronGridService.js';

/** An incoming USDT TRC20 transfer observed on-chain. */
export interface IncomingUsdtTransfer {
  txid: string;
  fromAddress: string;
  toAddress: string;
  /** Amount in USDT (already divided by 1e6). */
  amountUsdt: number;
  confirmations: number;
  blockTimestamp: number;
}

export interface WithdrawalBroadcastResult {
  txid: string;
}

export interface TransactionStatusResult {
  txid: string;
  confirmed: boolean;
  succeeded: boolean;
  message?: string;
}

/**
 * Tron USDT (TRC20) abstraction. Implementations:
 *  - SimulatedTronService: no real chain interaction (default).
 *  - TronGridTronService: real TronGrid API; withdrawals only when explicitly
 *    enabled and signed by the server-side hot wallet key.
 *
 * SECURITY: the hot wallet private key lives ONLY in server environment
 * configuration and is never exposed through any API endpoint.
 */
export interface TronService {
  getDepositAddress(): Promise<string>;
  getIncomingUsdtTransfers(): Promise<IncomingUsdtTransfer[]>;
  sendUsdtWithdrawal(params: {
    destinationAddress: string;
    amountUsdt: number;
  }): Promise<WithdrawalBroadcastResult>;
  getTransactionStatus(txid: string): Promise<TransactionStatusResult>;
}

/** Fixed simulated deposit address (34-char base58, T-prefixed). */
export { SIMULATED_DEPOSIT_ADDRESS };

/**
 * Simulated Tron service: generates fake transfers on demand and never talks
 * to a real chain.
 */
export class SimulatedTronService implements TronService {
  private readonly transfers: IncomingUsdtTransfer[] = [];

  /** Creates a fake incoming transfer (used by POST /api/deposits/simulate). */
  simulateIncomingUsdt(amountUsdt: number, fromAddress?: string): IncomingUsdtTransfer {
    const transfer: IncomingUsdtTransfer = {
      txid: `sim-${randomUUID()}`,
      fromAddress: fromAddress ?? 'TSimulatedSenderAddress000000000000',
      toAddress: this.address(),
      amountUsdt,
      confirmations: 999,
      blockTimestamp: Date.now(),
    };
    this.transfers.push(transfer);
    return transfer;
  }

  /** DB-stored trade address (Phase 6.5.1) → env → simulated placeholder. */
  private address(): string {
    return resolveUsdtTradeAddress().address || SIMULATED_DEPOSIT_ADDRESS;
  }

  async getDepositAddress(): Promise<string> {
    return this.address();
  }

  async getIncomingUsdtTransfers(): Promise<IncomingUsdtTransfer[]> {
    return [...this.transfers];
  }

  async sendUsdtWithdrawal(_params: {
    destinationAddress: string;
    amountUsdt: number;
  }): Promise<WithdrawalBroadcastResult> {
    // Simulated withdrawals are handled by the withdrawal flow itself;
    // reaching the chain here would be a bug.
    throw new Error('simulated Tron service does not broadcast transactions');
  }

  async getTransactionStatus(txid: string): Promise<TransactionStatusResult> {
    return { txid, confirmed: true, succeeded: true };
  }
}

/** Builds the active Tron service from configuration. */
export function createTronService(): TronService {
  if (config.TRON_MODE === 'SIMULATED') {
    return new SimulatedTronService();
  }
  return new TronGridTronService(config.TRON_MODE);
}

/** Singleton used by routes and the deposit sync loop. */
export const tronService: TronService = createTronService();
