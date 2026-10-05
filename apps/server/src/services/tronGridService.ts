import type { TronMode } from '@aioption/shared';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveUsdtTokenContract, resolveUsdtTradeAddress } from './appSettings.js';
import type {
  IncomingUsdtTransfer,
  TransactionStatusResult,
  TronService,
  WithdrawalBroadcastResult,
} from './tronService.js';

/** TronGrid REST base URLs per network mode. */
export const TRONGRID_BASE: Record<Exclude<TronMode, 'SIMULATED'>, string> = {
  SHASTA: 'https://api.shasta.trongrid.io',
  NILE: 'https://nile.trongrid.io',
  MAINNET: 'https://api.trongrid.io',
};

/** Effective RPC base: TRON_RPC_URL (testnets) overrides the built-in default. */
export function tronRpcBase(mode: Exclude<TronMode, 'SIMULATED'>): string {
  return mode !== 'MAINNET' && config.TRON_RPC_URL ? config.TRON_RPC_URL : TRONGRID_BASE[mode];
}

export interface TronAccountResources {
  /** TRX balance in TRX (not SUN). */
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  /** Latest block number (proves the node is reachable). */
  latestBlock: number;
}

const REQUEST_TIMEOUT_MS = 8_000;
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

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
    this.baseUrl = tronRpcBase(mode);
  }

  private headers(): Record<string, string> {
    return config.TRON_GRID_API_KEY ? { 'TRON-PRO-API-KEY': config.TRON_GRID_API_KEY } : {};
  }

  /**
   * Phase 7: real connectivity + fee-resource probe. Reads the latest block
   * (node reachable) and, if an address is given, its TRX balance, energy and
   * bandwidth. Read-only — never needs a private key.
   */
  async probe(address: string | null): Promise<TronAccountResources> {
    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`trongrid ${path}: HTTP ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    };
    const block = (await post('/wallet/getnowblock', {})) as {
      block_header?: { raw_data?: { number?: number } };
    };
    const latestBlock = Number(block.block_header?.raw_data?.number ?? 0);
    if (!(latestBlock > 0)) {
      throw new Error('trongrid: no block height returned');
    }
    if (!address || !TRON_ADDRESS_RE.test(address)) {
      return { trxBalance: 0, energyAvailable: 0, bandwidthAvailable: 0, latestBlock };
    }
    const account = (await post('/wallet/getaccount', { address, visible: true })) as { balance?: number };
    const resources = (await post('/wallet/getaccountresource', { address, visible: true })) as {
      EnergyLimit?: number;
      EnergyUsed?: number;
      freeNetLimit?: number;
      freeNetUsed?: number;
      NetLimit?: number;
      NetUsed?: number;
    };
    const n = (v: number | undefined) => (Number.isFinite(v) ? Number(v) : 0);
    return {
      trxBalance: n(account.balance) / 1e6,
      energyAvailable: Math.max(0, n(resources.EnergyLimit) - n(resources.EnergyUsed)),
      bandwidthAvailable: Math.max(
        0,
        n(resources.freeNetLimit) - n(resources.freeNetUsed) + n(resources.NetLimit) - n(resources.NetUsed),
      ),
      latestBlock,
    };
  }

  /** DB-stored trade address (Phase 6.5.1) or TRON_DEPOSIT_ADDRESS. */
  async getDepositAddress(): Promise<string> {
    const resolved = resolveUsdtTradeAddress();
    if (resolved.source !== 'DATABASE' && resolved.source !== 'ENVIRONMENT') {
      throw new Error(
        'TRON_DEPOSIT_ADDRESS is not configured for live Tron mode — set it in the environment or save a USDT trade address in the UI',
      );
    }
    return resolved.address;
  }

  async getIncomingUsdtTransfers(): Promise<IncomingUsdtTransfer[]> {
    const address = await this.getDepositAddress();
    // Phase 7.4: the DB-saved token contract overrides the env default. Only
    // transfers of THIS contract are ever returned (contract-scoped query).
    const contract = resolveUsdtTokenContract().address;
    if (!contract) {
      throw new Error('TRON_USDT_CONTRACT_ADDRESS is not configured for live Tron mode');
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
        amountUsdt: Number(t.value) / 1e6,
        contractAddress: contract,
        confirmations: 0,
        blockTimestamp: t.block_timestamp,
      }));
  }

  async sendUsdtWithdrawal(params: {
    destinationAddress: string;
    amountUsdt: number;
  }): Promise<WithdrawalBroadcastResult> {
    if (!config.ENABLE_LIVE_TRON_WITHDRAWALS) {
      throw new Error('live Tron withdrawals are disabled');
    }
    const privateKey = config.TRON_HOT_WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('TRON_HOT_WALLET_PRIVATE_KEY is not configured');
    }
    const contract = resolveUsdtTokenContract().address;
    if (!contract) {
      throw new Error('TRON_USDT_CONTRACT_ADDRESS is not configured');
    }

    // Lazy import: tronweb only loads when real withdrawals are enabled.
    const { TronWeb } = await import('tronweb');
    const tronWeb = new TronWeb({
      fullHost: this.baseUrl,
      privateKey,
      headers: this.headers(),
    });
    const usdt = await tronWeb.contract().at(contract);
    const amountSun = Math.round(params.amountUsdt * 1e6);
    // USDT TRC20 transfer; feeLimit covers energy/bandwidth (wallet must hold TRX).
    const result = (await usdt.transfer(params.destinationAddress, amountSun).send({
      feeLimit: 100_000_000,
    })) as string;
    logger.info({ txid: result }, 'Tron USDT withdrawal broadcast');
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
