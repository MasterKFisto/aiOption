import type { TronConnectionStatus, TronFeeEstimate, TronReadiness, TronStatus } from '@aioption/shared';

import { config } from '../config.js';
import { feeWalletTrxBalance, logTronStatusCheck } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { resolveTrxFeeWalletAddress, resolveUsdtTokenContract, resolveUsdtTradeAddress } from './appSettings.js';
import { explorerBase, isTestnet, NETWORK_NAMES } from './tronNetwork.js';

let lastCheckedAt: string | null = null;

/**
 * Result of the latest REAL network probe (Phase 7). Before this, the status
 * never contacted the chain — "connected" only meant "configured".
 */
interface ProbeResult {
  ok: boolean;
  at: string;
  latestBlock: number;
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  error: string | null;
}
let lastProbe: ProbeResult | null = null;
/** A probe older than this no longer counts as "connected". */
const PROBE_MAX_AGE_MS = 3 * 60_000;

/** Injectable prober (tests replace it; production uses TronGrid). */
export type TronProber = (address: string | null) => Promise<{
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  latestBlock: number;
}>;
let prober: TronProber | null = null;
export function setTronProber(next: TronProber | null): void {
  prober = next;
  lastProbe = null;
  lastCheckedAt = null;
}

async function defaultProber(address: string | null) {
  const { TronGridTronService } = await import('./tronGridService.js');
  if (config.TRON_MODE === 'SIMULATED') {
    throw new Error('simulated mode has no network');
  }
  return new TronGridTronService(config.TRON_MODE).probe(address);
}

/** Address whose TRX/energy pays withdrawal fees: hot wallet, else fee wallet. */
function feePayerAddress(): string | null {
  if (config.TRON_HOT_WALLET_ADDRESS) {
    return config.TRON_HOT_WALLET_ADDRESS;
  }
  const fee = resolveTrxFeeWalletAddress();
  return fee.source === 'SIMULATED' || fee.source === 'NOT_SET' ? null : fee.address;
}

/** Runs one real network probe and caches the result (never throws). */
export async function probeTronNetwork(): Promise<ProbeResult | null> {
  if (config.TRON_MODE === 'SIMULATED') {
    return null;
  }
  const at = new Date().toISOString();
  try {
    const r = await (prober ?? defaultProber)(feePayerAddress());
    lastProbe = { ok: true, at, error: null, ...r };
  } catch (err) {
    lastProbe = {
      ok: false,
      at,
      latestBlock: 0,
      trxBalance: lastProbe?.trxBalance ?? 0,
      energyAvailable: lastProbe?.energyAvailable ?? 0,
      bandwidthAvailable: lastProbe?.bandwidthAvailable ?? 0,
      // Never echo URLs/keys — only a short reason.
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    };
  }
  lastCheckedAt = at;
  return lastProbe;
}

/** On-chain fee resources from the last SUCCESSFUL probe (null if none). */
export function lastProbedResources(): {
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  at: string;
} | null {
  if (config.TRON_MODE === 'SIMULATED' || !lastProbe?.ok) {
    return null;
  }
  return {
    trxBalance: lastProbe.trxBalance,
    energyAvailable: lastProbe.energyAvailable,
    bandwidthAvailable: lastProbe.bandwidthAvailable,
    at: lastProbe.at,
  };
}

let probeTimer: NodeJS.Timeout | null = null;
/** Background probe every 60 s in real-network modes (Phase 7). */
export function startTronProbe(intervalMs = 60_000): void {
  if (probeTimer || config.TRON_MODE === 'SIMULATED') {
    return;
  }
  void probeTronNetwork();
  probeTimer = setInterval(() => void probeTronNetwork(), intervalMs);
}
export function stopTronProbe(): void {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

/** Simulated hot-wallet fee resources (SIMULATED mode only). */
function simulatedResources(): {
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
} {
  return { trxBalance: 120, energyAvailable: 100_000, bandwidthAvailable: 5_000 };
}

/** Builds the Tron network status for the UI indicator and modal. */
export function getTronStatus(): TronStatus {
  const simulated = config.TRON_MODE === 'SIMULATED';
  const resources = simulated
    ? simulatedResources()
    : {
        trxBalance: lastProbe?.trxBalance ?? 0,
        energyAvailable: lastProbe?.energyAvailable ?? 0,
        bandwidthAvailable: lastProbe?.bandwidthAvailable ?? 0,
      };

  const tradeAddress = resolveUsdtTradeAddress();
  const warnings: string[] = [];
  let connectionStatus: TronConnectionStatus = 'CONNECTED';
  let readiness: TronReadiness = 'READY_TO_TRADE';

  if (simulated) {
    warnings.push('simulated Tron mode — no real chain interaction');
  } else {
    if (config.TRON_MODE !== 'MAINNET') {
      warnings.push('testnet — test tokens only, no real funds');
    }
    const fresh = lastProbe !== null && Date.now() - new Date(lastProbe.at).getTime() <= PROBE_MAX_AGE_MS;
    // The trade address may come from the DB (UI) or the environment.
    const configured =
      (tradeAddress.source === 'DATABASE' || tradeAddress.source === 'ENVIRONMENT') &&
      config.TRON_USDT_CONTRACT_ADDRESS.length > 0;
    if (!lastProbe) {
      connectionStatus = 'DEGRADED';
      warnings.push('Tron connectivity has not been checked yet');
    } else if (!lastProbe.ok || !fresh) {
      connectionStatus = 'DISCONNECTED';
      readiness = 'TRADE_BLOCKED';
      warnings.push(
        lastProbe.ok
          ? 'last Tron network check is stale'
          : `Tron network unreachable: ${lastProbe.error ?? 'unknown error'}`,
      );
    }
    if (!configured) {
      if (connectionStatus === 'CONNECTED') {
        connectionStatus = 'NOT_CONFIGURED';
      }
      readiness = 'CONFIGURATION_MISSING';
      warnings.push(
        'Tron configuration missing: save a USDT trade address (or set TRON_DEPOSIT_ADDRESS) and set TRON_USDT_CONTRACT_ADDRESS',
      );
    }
    if (config.ENABLE_LIVE_TRON_WITHDRAWALS === false && config.TRON_HOT_WALLET_PRIVATE_KEY === '') {
      warnings.push('withdrawal broadcast disabled: no TRON_HOT_WALLET_PRIVATE_KEY configured');
    }
  }

  const lowFeeResource = resources.trxBalance < config.TRON_MIN_TRX_BALANCE_FOR_WITHDRAWAL;
  if (lowFeeResource && config.ENABLE_LIVE_TRON_WITHDRAWALS) {
    if (readiness === 'READY_TO_TRADE') {
      readiness = 'FEE_RESOURCE_LOW';
    }
    warnings.push(
      `hot wallet TRX balance (${resources.trxBalance}) is below the ${config.TRON_MIN_TRX_BALANCE_FOR_WITHDRAWAL} minimum for withdrawals`,
    );
  }
  if (!config.ENABLE_LIVE_TRON_WITHDRAWALS && !simulated) {
    // Keep the more severe states (disconnected / config missing) visible.
    if (readiness === 'READY_TO_TRADE' || readiness === 'FEE_RESOURCE_LOW') {
      readiness = 'WITHDRAWAL_BLOCKED';
    }
    warnings.push('live withdrawals are disabled (ENABLE_LIVE_TRON_WITHDRAWALS=false)');
  }

  return {
    mode: config.TRON_MODE,
    networkName: config.TRON_NETWORK_NAME || (NETWORK_NAMES[config.TRON_MODE] ?? config.TRON_MODE),
    tradingMode: config.MODE,
    isTestnet: isTestnet(),
    explorerUrl: explorerBase(),
    latestBlock: lastProbe?.ok ? lastProbe.latestBlock : null,
    connectionStatus,
    readyToTrade: simulated || connectionStatus === 'CONNECTED',
    readiness,
    depositsEnabled: true,
    withdrawalsEnabled: simulated || config.ENABLE_LIVE_TRON_WITHDRAWALS,
    liveWithdrawalsEnabled: config.ENABLE_LIVE_TRON_WITHDRAWALS,
    depositAddress: tradeAddress.address,
    depositAddressSource: tradeAddress.source,
    hotWalletAddress: config.TRON_HOT_WALLET_ADDRESS,
    usdtContractAddress: resolveUsdtTokenContract().address,
    requiredConfirmations: config.TRON_REQUIRED_CONFIRMATIONS,
    trxBalance: resources.trxBalance,
    energyAvailable: resources.energyAvailable,
    bandwidthAvailable: resources.bandwidthAvailable,
    lowFeeResource,
    lastCheckedAt,
    warnings,
  };
}

/**
 * Attempts a connectivity check against the configured Tron service. In
 * simulated mode this always succeeds; otherwise it reports degraded when the
 * configuration is incomplete.
 */
export async function checkTronHealth(): Promise<{ healthy: boolean; status: TronStatus }> {
  // Phase 7: perform a REAL network probe (was: "configured" ⇒ healthy).
  await probeTronNetwork();
  const nowIso = new Date().toISOString();
  const status = getTronStatus();
  const healthy =
    status.mode === 'SIMULATED' ||
    status.connectionStatus === 'CONNECTED' ||
    status.connectionStatus === 'NOT_CONFIGURED';
  lastCheckedAt = nowIso;
  logTronStatusCheck({
    mode: status.mode,
    networkName: status.networkName,
    connectionStatus: status.connectionStatus,
    readyToTrade: status.readyToTrade,
    trxBalance: status.trxBalance,
    energyAvailable: status.energyAvailable,
    bandwidthAvailable: status.bandwidthAvailable,
    warnings: status.warnings.join('; '),
  });
  publishEvent('tron', { action: 'HEALTH_CHECK', status: { ...status, lastCheckedAt: nowIso } });
  return { healthy, status: { ...status, lastCheckedAt: nowIso } };
}

/** Estimated Tron network fee for a USDT (TRC20) withdrawal. */
export function estimateWithdrawalFee(destinationAddress: string): TronFeeEstimate {
  void destinationAddress; // reserved for future per-address estimation
  const simulated = config.TRON_MODE === 'SIMULATED';
  // Fee reserve comes from the TRX fee wallet (Phase 6.5), not the hot wallet.
  const reserve = feeWalletTrxBalance();
  // Phase 7: in real-network modes prefer the ON-CHAIN balance from the last
  // successful probe; fall back to the internal fee-reserve ledger.
  const probed = !simulated && lastProbe?.ok ? lastProbe : null;
  const resources = simulated
    ? { trxBalance: reserve, energyAvailable: 100_000, bandwidthAvailable: 5_000 }
    : probed
      ? {
          trxBalance: probed.trxBalance,
          energyAvailable: probed.energyAvailable,
          bandwidthAvailable: probed.bandwidthAvailable,
        }
      : { trxBalance: reserve, energyAvailable: 0, bandwidthAvailable: 0 };

  const estimatedFeeTrx = config.TRON_WITHDRAWAL_FEE_ESTIMATE_TRX;
  const estimatedFeeUsd = Math.round(estimatedFeeTrx * config.TRON_USD_TRX_PRICE * 100) / 100;
  const energyRequired = simulated ? 31_895 : 65_000;
  const bandwidthRequired = 345;

  // Energy can be staked OR paid by burning TRX (the estimate covers the burn).
  const energyOk = resources.energyAvailable >= energyRequired || (probed !== null && resources.trxBalance >= estimatedFeeTrx);
  const sufficientFeeResources =
    simulated ||
    (resources.trxBalance >= config.TRON_MIN_TRX_FEE_RESERVE &&
      resources.trxBalance >= estimatedFeeTrx &&
      energyOk);

  const warnings: string[] = [];
  if (!sufficientFeeResources && !simulated) {
    warnings.push(
      `hot wallet TRX balance (${resources.trxBalance}) or energy may be insufficient — fund the hot wallet with TRX or energy before withdrawing USDT`,
    );
  }
  if (config.TRON_WITHDRAWAL_FEE_POLICY === 'BLOCK_IF_INSUFFICIENT') {
    warnings.push(
      'fee policy BLOCK_IF_INSUFFICIENT: withdrawals are blocked when fee resources are insufficient',
    );
  }

  return {
    network: 'TRON',
    asset: 'USDT',
    tokenStandard: 'TRC20',
    estimatedFeeTrx,
    estimatedFeeUsd,
    feePayer:
      config.TRON_WITHDRAWAL_FEE_POLICY === 'DEDUCT_USDT_FROM_WITHDRAWAL'
        ? 'DEDUCT_FROM_WITHDRAWAL'
        : 'HOT_WALLET',
    energyRequired,
    bandwidthRequired,
    hotWalletTrxBalance: resources.trxBalance,
    hotWalletEnergyAvailable: resources.energyAvailable,
    sufficientFeeResources,
    warnings,
  };
}
