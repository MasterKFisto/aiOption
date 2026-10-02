import type { TronMode } from '@aioption/shared';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveUsdcTradeAddress } from './appSettings.js';
import type {
  IncomingUsdcTransfer,
  TransactionStatusResult,
  TronService,
  WithdrawalBroadcastResult,
} from './tronService.js';

/** TronGrid REST base URLs per network mode. */
const TRONGRID_BASE: Record<Exclude<TronMode, 'SIMULATED'>, string> = {
  SHASTA: 'https://api.shasta.trongrid.io',
  NILE: 'https://nile.trongrid.io',
  MAINNET: 'https://api.trongrid.io',
};

/**
 * Real Tron service backed by TronGrid. Read-only operations (deposit address,
 * incoming transfers, transaction status) always work; withdrawals only
 * broadcast when ENABLE_LIVE_TRON_WITHDRAWALS=true and a hot wallet private
 * key is configured.
 *
 * WARNING: the hot wallet must hold TRX for energy and bandwidth fees.
 */
export class TronGridTronService implements TronService {
  private readonly baseUrl: string;

  constructor(mode: Exclude<TronMode, 'SIMULATED'>) {
    this.baseUrl = TRONGRID_BASE[mode];
  }

  private headers(): Record<string, string> {
    return config.TRON_GRID_API_KEY ? { 'TRON-PRO-API-KEY': config.TRON_GRID_API_KEY } : {};
  }

  /** DB-stored trade address (Phase 6.5.1) or TRON_DEPOSIT_ADDRESS. */
  async getDepositAddress(): Promise<string> {
    const resolved = resolveUsdcTradeAddress();
    if (resolved.source !== 'DATABASE' && resolved.source !== 'ENVIRONMENT') {
      throw new Error(
        'TRON_DEPOSIT_ADDRESS is not configured for live Tron mode — set it in the environment or save a USDC trade address in the UI',
      );
    }
    return resolved.address;
  }

  async getIncomingUsdcTransfers(): Promise<IncomingUsdcTransfer[]> {
    const address = await this.getDepositAddress();
    const contract = config.TRON_USDC_CONTRACT_ADDRESS;
    if (!contract) {
      throw new Error('TRON_USDC_CONTRACT_ADDRESS is not configured for live Tron mode');
    }
    const url =
      `${this.baseUrl}/v1/accounts/${address}/transactions/trc20` +
      `?contract_address=${contract}&only_confirmed=true&limit=20&order_by=block_timestamp,desc`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`trongrid trc20 transfers: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: Array<{
        transaction_id: string;
        from: string;
        to: string;
        value: string;
        block_timestamp: number;
      }>;
    };
    return (body.data ?? [])
      .filter((t) => t.to === address)
      .map((t) => ({
        txid: t.transaction_id,
        fromAddress: t.from,
        toAddress: t.to,
        amountUsdc: Number(t.value) / 1e6,
        confirmations: 0,
        blockTimestamp: t.block_timestamp,
      }));
  }

  async sendUsdcWithdrawal(params: {
    destinationAddress: string;
    amountUsdc: number;
  }): Promise<WithdrawalBroadcastResult> {
    if (!config.ENABLE_LIVE_TRON_WITHDRAWALS) {
      throw new Error('live Tron withdrawals are disabled');
    }
    const privateKey = config.TRON_HOT_WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('TRON_HOT_WALLET_PRIVATE_KEY is not configured');
    }
    const contract = config.TRON_USDC_CONTRACT_ADDRESS;
    if (!contract) {
      throw new Error('TRON_USDC_CONTRACT_ADDRESS is not configured');
    }

    // Lazy import: tronweb only loads when real withdrawals are enabled.
    const { TronWeb } = await import('tronweb');
    const tronWeb = new TronWeb({
      fullHost: this.baseUrl,
      privateKey,
      headers: this.headers(),
    });
    const usdc = await tronWeb.contract().at(contract);
    const amountSun = Math.round(params.amountUsdc * 1e6);
    // USDC TRC20 transfer; feeLimit covers energy/bandwidth (wallet must hold TRX).
    const result = (await usdc.transfer(params.destinationAddress, amountSun).send({
      feeLimit: 100_000_000,
    })) as string;
    logger.info({ txid: result }, 'Tron USDC withdrawal broadcast');
    return { txid: result };
  }

  async getTransactionStatus(txid: string): Promise<TransactionStatusResult> {
    const res = await fetch(`${this.baseUrl}/v1/transactions/${txid}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      return { txid, confirmed: false, succeeded: false, message: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      ret?: Array<{ contractRet?: string }>;
    };
    const succeeded = body.ret?.[0]?.contractRet === 'SUCCESS';
    return { txid, confirmed: succeeded, succeeded };
  }
}
