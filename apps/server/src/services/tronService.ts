import { randomUUID } from 'node:crypto';

import { config } from '../config.js';
import { SIMULATED_DEPOSIT_ADDRESS, resolveUsdcTradeAddress } from './appSettings.js';
import { TronGridTronService } from './tronGridService.js';

/** An incoming USDC TRC20 transfer observed on-chain. */
export interface IncomingUsdcTransfer {
  txid: string;
  fromAddress: string;
  toAddress: string;
  /** Amount in USDC (already divided by 1e6). */
  amountUsdc: number;
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
 * Tron USDC (TRC20) abstraction. Implementations:
 *  - SimulatedTronService: no real chain interaction (default).
 *  - TronGridTronService: real TronGrid API; withdrawals only when explicitly
 *    enabled and signed by the server-side hot wallet key.
 *
 * SECURITY: the hot wallet private key lives ONLY in server environment
 * configuration and is never exposed through any API endpoint.
 */
export interface TronService {
  getDepositAddress(): Promise<string>;
  getIncomingUsdcTransfers(): Promise<IncomingUsdcTransfer[]>;
  sendUsdcWithdrawal(params: {
    destinationAddress: string;
    amountUsdc: number;
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
  private readonly transfers: IncomingUsdcTransfer[] = [];

  /** Creates a fake incoming transfer (used by POST /api/deposits/simulate). */
  simulateIncomingUsdc(amountUsdc: number, fromAddress?: string): IncomingUsdcTransfer {
    const transfer: IncomingUsdcTransfer = {
      txid: `sim-${randomUUID()}`,
      fromAddress: fromAddress ?? 'TSimulatedSenderAddress000000000000',
      toAddress: this.address(),
      amountUsdc,
      confirmations: 999,
      blockTimestamp: Date.now(),
    };
    this.transfers.push(transfer);
    return transfer;
  }

  /** DB-stored trade address (Phase 6.5.1) → env → simulated placeholder. */
  private address(): string {
    return resolveUsdcTradeAddress().address || SIMULATED_DEPOSIT_ADDRESS;
  }

  async getDepositAddress(): Promise<string> {
    return this.address();
  }

  async getIncomingUsdcTransfers(): Promise<IncomingUsdcTransfer[]> {
    return [...this.transfers];
  }

  async sendUsdcWithdrawal(_params: {
    destinationAddress: string;
    amountUsdc: number;
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
