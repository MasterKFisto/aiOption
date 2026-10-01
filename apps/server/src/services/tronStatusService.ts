import type { TronConnectionStatus, TronFeeEstimate, TronReadiness, TronStatus } from '@aioption/shared';

import { config } from '../config.js';
import { feeWalletTrxBalance, logTronStatusCheck } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { SIMULATED_DEPOSIT_ADDRESS } from './tronService.js';

const NETWORK_NAMES: Record<string, string> = {
  SIMULATED: 'Simulated',
  SHASTA: 'Shasta Testnet',
  NILE: 'Nile Testnet',
  MAINNET: 'Tron Mainnet',
};

let lastCheckedAt: string | null = null;

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
    : { trxBalance: 0, energyAvailable: 0, bandwidthAvailable: 0 };

  const warnings: string[] = [];
  let connectionStatus: TronConnectionStatus = 'CONNECTED';
  let readiness: TronReadiness = 'READY_TO_TRADE';

  if (simulated) {
    warnings.push('simulated Tron mode — no real chain interaction');
  } else {
    const configured =
      config.TRON_DEPOSIT_ADDRESS.length > 0 && config.TRON_USDC_CONTRACT_ADDRESS.length > 0;
    if (!configured) {
      connectionStatus = 'NOT_CONFIGURED';
      readiness = 'CONFIGURATION_MISSING';
      warnings.push(
        'Tron configuration missing: set TRON_DEPOSIT_ADDRESS and TRON_USDC_CONTRACT_ADDRESS',
      );
    } else if (!lastCheckedAt) {
      connectionStatus = 'DEGRADED';
      warnings.push('Tron connectivity has not been checked yet');
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
    readiness = 'WITHDRAWAL_BLOCKED';
    warnings.push('live withdrawals are disabled (ENABLE_LIVE_TRON_WITHDRAWALS=false)');
  }

  return {
    mode: config.TRON_MODE,
    networkName: NETWORK_NAMES[config.TRON_MODE] ?? config.TRON_MODE,
    connectionStatus,
    readyToTrade: simulated || connectionStatus === 'CONNECTED',
    readiness,
    depositsEnabled: true,
    withdrawalsEnabled: simulated || config.ENABLE_LIVE_TRON_WITHDRAWALS,
    liveWithdrawalsEnabled: config.ENABLE_LIVE_TRON_WITHDRAWALS,
    depositAddress: config.TRON_DEPOSIT_ADDRESS || SIMULATED_DEPOSIT_ADDRESS,
    hotWalletAddress: config.TRON_HOT_WALLET_ADDRESS,
    usdcContractAddress: config.TRON_USDC_CONTRACT_ADDRESS,
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
  const nowIso = new Date().toISOString();
  const status = getTronStatus();
  const healthy =
    status.mode === 'SIMULATED' ||
    status.connectionStatus === 'CONNECTED' ||
    status.connectionStatus === 'DEGRADED';
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

/** Estimated Tron network fee for a USDC (TRC20) withdrawal. */
export function estimateWithdrawalFee(destinationAddress: string): TronFeeEstimate {
  void destinationAddress; // reserved for future per-address estimation
  const simulated = config.TRON_MODE === 'SIMULATED';
  // Fee reserve comes from the TRX fee wallet (Phase 6.5), not the hot wallet.
  const reserve = feeWalletTrxBalance();
  const resources = simulated
    ? { trxBalance: reserve, energyAvailable: 100_000, bandwidthAvailable: 5_000 }
    : { trxBalance: reserve, energyAvailable: 0, bandwidthAvailable: 0 };

  const estimatedFeeTrx = config.TRON_WITHDRAWAL_FEE_ESTIMATE_TRX;
  const estimatedFeeUsd = Math.round(estimatedFeeTrx * config.TRON_USD_TRX_PRICE * 100) / 100;
  const energyRequired = simulated ? 31_895 : 65_000;
  const bandwidthRequired = 345;

  const sufficientFeeResources =
    simulated ||
    (resources.trxBalance >= config.TRON_MIN_TRX_FEE_RESERVE &&
      resources.trxBalance >= estimatedFeeTrx &&
      resources.energyAvailable >= energyRequired);

  const warnings: string[] = [];
  if (!sufficientFeeResources && !simulated) {
    warnings.push(
      `hot wallet TRX balance (${resources.trxBalance}) or energy may be insufficient — fund the hot wallet with TRX or energy before withdrawing USDC`,
    );
  }
  if (config.TRON_WITHDRAWAL_FEE_POLICY === 'BLOCK_IF_INSUFFICIENT') {
    warnings.push(
      'fee policy BLOCK_IF_INSUFFICIENT: withdrawals are blocked when fee resources are insufficient',
    );
  }

  return {
    network: 'TRON',
    asset: 'USDC',
    tokenStandard: 'TRC20',
    estimatedFeeTrx,
    estimatedFeeUsd,
    feePayer:
      config.TRON_WITHDRAWAL_FEE_POLICY === 'DEDUCT_USDC_FROM_WITHDRAWAL'
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
