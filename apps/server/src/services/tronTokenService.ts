import type { TronMode, TronTokenStatus } from '@aioption/shared';
import { TESTNET_TOKEN_DECIMALS, TESTNET_TOKEN_NAME, TESTNET_TOKEN_SYMBOL } from '@aioption/shared';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveUsdtTokenContract, resolveUsdtTradeAddress } from './appSettings.js';
import { isKnownMainnetToken, KNOWN_MAINNET_TOKENS } from './knownTokens.js';
import { isValidTronAddress, tronAddressToHex } from './tronAddress.js';
import { tronRpcBase } from './tronGridService.js';
import { NETWORK_NAMES } from './tronNetwork.js';

/** UI warning shown when no token contract is configured (Phase 7.4 spec). */
export const TOKEN_NOT_CONFIGURED_WARNING = 'USDT token contract is not configured.';

/** Withdrawal block message when the hot wallet holds too little of the token. */
export const INSUFFICIENT_HOT_WALLET_TOKEN_MESSAGE = 'Insufficient USDT token balance in hot wallet.';

/**
 * Injectable chain querier (tests replace it; production uses TronGrid).
 * Mirrors the tronStatusService prober pattern.
 */
export interface TokenQuerier {
  /** Latest block number — throws when the RPC is unreachable. */
  probeRpc(): Promise<number>;
  /** Raw constant_result hex, or null when the contract returned nothing. */
  callConstant(contract: string, functionSelector: string, parameterHex: string): Promise<string | null>;
  /** True when the address holds contract code on-chain. */
  contractExists(contract: string): Promise<boolean>;
  /** TRX balance (in TRX) of an address. */
  trxBalance(address: string): Promise<number>;
}

let querier: TokenQuerier | null = null;

/** Test hook: replace the chain querier (null restores the TronGrid default). */
export function setTokenQuerier(next: TokenQuerier | null): void {
  querier = next;
  resetTokenStatusCache();
}

function defaultQuerier(): TokenQuerier {
  const mode = config.TRON_MODE as Exclude<TronMode, 'SIMULATED'>;
  const base = tronRpcBase(mode);
  const headers = (): Record<string, string> =>
    config.TRON_GRID_API_KEY ? { 'TRON-PRO-API-KEY': config.TRON_GRID_API_KEY } : {};
  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`trongrid ${path}: HTTP ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    async probeRpc() {
      const block = (await post('/wallet/getnowblock', {})) as {
        block_header?: { raw_data?: { number?: number } };
      };
      const latest = Number(block.block_header?.raw_data?.number ?? 0);
      if (!(latest > 0)) {
        throw new Error('trongrid: no block height returned');
      }
      return latest;
    },
    async callConstant(contract, functionSelector, parameterHex) {
      // owner_address only pays for nothing in a constant call but must be a
      // valid address — the deposit address when valid, else the contract.
      const owner = resolveUsdtTradeAddress().address;
      const body = (await post('/wallet/triggerconstantcontract', {
        owner_address: isValidTronAddress(owner) ? owner : contract,
        contract_address: contract,
        function_selector: functionSelector,
        parameter: parameterHex,
        visible: true,
      })) as { constant_result?: string[] };
      const result = body.constant_result;
      return result && result.length > 0 && result[0] ? result[0] : null;
    },
    async contractExists(contract) {
      const body = (await post('/wallet/getcontract', { value: contract, visible: true })) as {
        bytecode?: string;
      };
      return typeof body.bytecode === 'string' && body.bytecode.length > 0;
    },
    async trxBalance(address) {
      const body = (await post('/wallet/getaccount', { address, visible: true })) as {
        balance?: number;
      };
      return Number(body.balance ?? 0) / 1e6;
    },
  };
}

/* ------------------------------ ABI decoding ------------------------------ */

/** Decodes an ABI string return (dynamic string, with a bytes32 fallback). */
export function decodeAbiString(hex: string): string {
  const clean = hex.replace(/^0x/, '');
  if (clean.length === 0) {
    return '';
  }
  if (clean.length >= 128) {
    try {
      const offset = Number(BigInt(`0x${clean.slice(0, 64)}`));
      if (offset === 32) {
        const length = Number(BigInt(`0x${clean.slice(64, 128)}`));
        const data = clean.slice(128, 128 + length * 2);
        return Buffer.from(data, 'hex').toString('utf8').replace(/ +$/g, '');
      }
    } catch {
      // fall through to the bytes32 decode
    }
  }
  return Buffer.from(clean.slice(0, 64), 'hex')
    .toString('utf8')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]+/g, '')
    .trim();
}

/** Decodes the last ABI uint256 word of a constant result. */
export function decodeAbiUint(hex: string): bigint {
  const clean = hex.replace(/^0x/, '');
  if (clean.length < 64) {
    return 0n;
  }
  return BigInt(`0x${clean.slice(-64)}`);
}

/** Formats a raw integer token amount with the contract's decimals. */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  if (decimals <= 0) {
    return raw.toString();
  }
  const padded = raw.toString().padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals);
  const fracPart = padded.slice(-decimals).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** 32-byte ABI parameter for an address argument (balanceOf). */
function addressParameterHex(address: string): string {
  return tronAddressToHex(address).padStart(64, '0');
}

/* ------------------------------ status checks ----------------------------- */

let cache: TronTokenStatus | null = null;
/** Token status is re-checked at most this often (manual refresh bypasses). */
const CACHE_MS = 60_000;

export function resetTokenStatusCache(): void {
  cache = null;
}

function networkName(): string {
  return config.TRON_NETWORK_NAME || NETWORK_NAMES[config.TRON_MODE] || config.TRON_MODE;
}

function rpcUrl(): string {
  return config.TRON_MODE === 'SIMULATED' ? '' : tronRpcBase(config.TRON_MODE as Exclude<TronMode, 'SIMULATED'>);
}

function baseStatus(): TronTokenStatus {
  const contract = resolveUsdtTokenContract();
  const deposit = resolveUsdtTradeAddress();
  return {
    tronMode: config.TRON_MODE,
    networkName: networkName(),
    rpcUrl: rpcUrl(),
    rpcConnected: false,
    depositAddress: deposit.address,
    hotWalletAddress: config.TRON_HOT_WALLET_ADDRESS,
    tokenContractAddress: contract.address,
    // resolveUsdtTokenContract never returns SIMULATED, but narrow for TS.
    tokenContractSource: contract.source === 'SIMULATED' ? 'NOT_SET' : contract.source,
    tokenConfigured: contract.source !== 'NOT_SET' && contract.address !== '',
    tokenConnected: false,
    simulated: false,
    tokenName: null,
    tokenSymbol: null,
    tokenDecimals: null,
    depositTokenBalance: null,
    hotWalletTokenBalance: null,
    hotWalletTrxBalance: null,
    expectedSymbol: config.TRON_USDT_EXPECTED_SYMBOL,
    expectedDecimals: config.TRON_USDT_EXPECTED_DECIMALS,
    allowTestToken: config.TRON_USDT_ALLOW_TEST_TOKEN,
    warnings: [],
    errors: [],
    lastCheckedAt: new Date().toISOString(),
  };
}

/** Simulated token info for local testing (never in LIVE mode). */
function simulatedStatus(status: TronTokenStatus): TronTokenStatus {
  return {
    ...status,
    rpcConnected: true,
    tokenConfigured: true,
    tokenConnected: true,
    simulated: true,
    tokenContractAddress: status.tokenContractAddress || 'TSimulatedUsdtTestTokenContract000000',
    tokenContractSource: status.tokenContractAddress ? status.tokenContractSource : 'NOT_SET',
    tokenName: TESTNET_TOKEN_NAME,
    tokenSymbol: TESTNET_TOKEN_SYMBOL,
    tokenDecimals: TESTNET_TOKEN_DECIMALS,
    depositTokenBalance: '0',
    hotWalletTokenBalance: '0',
    hotWalletTrxBalance: '0',
    warnings: [
      ...status.warnings,
      'Simulated token connection (TRON_TOKEN_SIMULATE_CONNECTION=true) — no on-chain data.',
    ],
  };
}

async function runChecks(): Promise<TronTokenStatus> {
  const status = baseStatus();
  const q = querier ?? defaultQuerier();

  // Local-testing preview (never in LIVE).
  if (config.TRON_TOKEN_SIMULATE_CONNECTION && config.MODE !== 'LIVE') {
    return simulatedStatus(status);
  }

  // 1. RPC reachability (simulated mode has no RPC to check).
  if (config.TRON_MODE === 'SIMULATED') {
    status.rpcConnected = true; // simulated network always "connects"
  } else {
    try {
      await q.probeRpc();
      status.rpcConnected = true;
    } catch (err) {
      logger.warn({ err }, 'token check: RPC unreachable');
      status.errors.push('TRON_RPC_UNREACHABLE');
      status.warnings.push('Tron RPC endpoint is unreachable — token status cannot be checked.');
      if (!status.tokenConfigured) {
        status.errors.push('TOKEN_CONTRACT_MISSING');
        status.warnings.push(TOKEN_NOT_CONFIGURED_WARNING);
      }
      return status;
    }
  }

  // 2. Address sanity (the SIMULATED placeholder is not a real address).
  const deposit = resolveUsdtTradeAddress();
  if (
    (deposit.source === 'DATABASE' || deposit.source === 'ENVIRONMENT') &&
    !isValidTronAddress(deposit.address)
  ) {
    status.errors.push('DEPOSIT_ADDRESS_INVALID');
    status.warnings.push('Deposit address is not a valid Tron address.');
  }
  if (status.hotWalletAddress && !isValidTronAddress(status.hotWalletAddress)) {
    status.errors.push('HOT_WALLET_ADDRESS_INVALID');
    status.warnings.push('Hot wallet address is not a valid Tron address.');
  }

  // 3. Token contract configured?
  if (!status.tokenConfigured) {
    status.errors.push('TOKEN_CONTRACT_MISSING');
    status.warnings.push(TOKEN_NOT_CONFIGURED_WARNING);
    return status;
  }
  if (!isValidTronAddress(status.tokenContractAddress)) {
    status.errors.push('TOKEN_CONTRACT_INVALID');
    status.warnings.push('USDT token contract address is not a valid Tron address.');
    return status;
  }

  // 4. Wrong-network guard: known mainnet token on a test network.
  if (config.TRON_MODE !== 'MAINNET' && isKnownMainnetToken(status.tokenContractAddress)) {
    status.warnings.push(
      `TOKEN CONTRACT WARNING: ${status.tokenContractAddress} is the known Tron MAINNET token ` +
        `(${KNOWN_MAINNET_TOKENS[status.tokenContractAddress]}) — it does not exist on ` +
        `${status.networkName}. Configure the Nile test token contract instead.`,
    );
  }

  if (config.TRON_MODE === 'SIMULATED') {
    // A configured contract can't be queried in simulated mode.
    status.warnings.push('Simulated Tron mode — the token contract cannot be queried on-chain.');
    return status;
  }

  // 5. Contract exists on-chain?
  try {
    if (!(await q.contractExists(status.tokenContractAddress))) {
      status.errors.push('TOKEN_CONTRACT_NOT_FOUND');
      status.warnings.push('No contract found at the configured USDT token address on this network.');
      return status;
    }
  } catch (err) {
    logger.warn({ err }, 'token check: contract lookup failed');
    status.errors.push('TOKEN_QUERY_FAILED');
    status.warnings.push('Token contract lookup failed.');
    return status;
  }

  // 6. TRC20 metadata: name, symbol, decimals.
  try {
    const [nameHex, symbolHex, decimalsHex] = await Promise.all([
      q.callConstant(status.tokenContractAddress, 'name()', ''),
      q.callConstant(status.tokenContractAddress, 'symbol()', ''),
      q.callConstant(status.tokenContractAddress, 'decimals()', ''),
    ]);
    if (!nameHex && !symbolHex && !decimalsHex) {
      status.errors.push('TOKEN_NOT_TRC20');
      status.warnings.push('The configured contract does not respond to TRC20 metadata calls.');
      return status;
    }
    status.tokenName = nameHex ? decodeAbiString(nameHex) : null;
    status.tokenSymbol = symbolHex ? decodeAbiString(symbolHex) : null;
    status.tokenDecimals = decimalsHex !== null ? Number(decodeAbiUint(decimalsHex)) : null;
  } catch (err) {
    logger.warn({ err }, 'token check: metadata query failed');
    status.errors.push('TOKEN_QUERY_FAILED');
    status.warnings.push('Token metadata query failed (name/symbol/decimals).');
    return status;
  }

  // 7. Symbol/decimals expectations.
  if (status.tokenSymbol !== null && status.tokenSymbol !== status.expectedSymbol) {
    const message =
      `Token symbol "${status.tokenSymbol}" does not match expected "${status.expectedSymbol}".` +
      (status.allowTestToken ? ' Accepted because TRON_USDT_ALLOW_TEST_TOKEN=true (test token).' : '');
    if (status.allowTestToken) {
      status.warnings.push(`TOKEN_SYMBOL_MISMATCH: ${message}`);
    } else {
      status.errors.push('TOKEN_SYMBOL_MISMATCH');
      status.warnings.push(`${message} Refused because TRON_USDT_ALLOW_TEST_TOKEN=false.`);
    }
  }
  if (status.tokenDecimals !== null && status.tokenDecimals !== status.expectedDecimals) {
    status.warnings.push(
      `TOKEN_DECIMALS_MISMATCH: token decimals ${status.tokenDecimals} do not match expected ` +
        `${status.expectedDecimals} — using the contract's actual decimals.`,
    );
  }

  // 8. Balances (failures here are warnings — the token itself connected).
  const decimals = status.tokenDecimals ?? status.expectedDecimals;
  if (status.depositAddress && isValidTronAddress(status.depositAddress)) {
    try {
      const raw = await q.callConstant(
        status.tokenContractAddress,
        'balanceOf(address)',
        addressParameterHex(status.depositAddress),
      );
      if (raw !== null) {
        status.depositTokenBalance = formatTokenAmount(decodeAbiUint(raw), decimals);
      }
    } catch (err) {
      logger.warn({ err }, 'token check: deposit balance query failed');
      status.warnings.push('TOKEN_QUERY_FAILED: deposit address token balance query failed.');
    }
  }
  if (status.hotWalletAddress && isValidTronAddress(status.hotWalletAddress)) {
    try {
      const raw = await q.callConstant(
        status.tokenContractAddress,
        'balanceOf(address)',
        addressParameterHex(status.hotWalletAddress),
      );
      if (raw !== null) {
        status.hotWalletTokenBalance = formatTokenAmount(decodeAbiUint(raw), decimals);
      }
      status.hotWalletTrxBalance = String(await q.trxBalance(status.hotWalletAddress));
    } catch (err) {
      logger.warn({ err }, 'token check: hot wallet balance query failed');
      status.warnings.push('TOKEN_QUERY_FAILED: hot wallet balance query failed.');
    }
  }

  status.tokenConnected = status.errors.length === 0;
  return status;
}

/**
 * Cached token status (≤ 60 s). Pass forceRefresh for the manual UI test.
 *
 * Phase 7.4.1: NEVER throws — an unexpected failure returns a controlled
 * diagnostic response (HTTP 200 with errors populated) instead of a 500, so a
 * token problem can never break the backend or the UI.
 */
export async function getTokenStatus(forceRefresh = false): Promise<TronTokenStatus> {
  if (
    !forceRefresh &&
    cache !== null &&
    cache.lastCheckedAt !== null &&
    Date.now() - Date.parse(cache.lastCheckedAt) < CACHE_MS
  ) {
    return cache;
  }
  try {
    const status = await runChecks();
    cache = status;
    return status;
  } catch (err) {
    logger.error({ err }, 'token status check failed unexpectedly');
    const status = baseStatus();
    status.errors.push('TOKEN_QUERY_FAILED');
    status.warnings.push('Token status check failed unexpectedly — see server logs.');
    return status;
  }
}

/** Manual "Test Token Connection" — always performs fresh chain queries. */
export function testTokenConnection(): Promise<TronTokenStatus> {
  return getTokenStatus(true);
}

/** Current hot-wallet token balance as a number (null when unavailable). */
export async function hotWalletTokenBalance(): Promise<number | null> {
  if (!config.TRON_HOT_WALLET_ADDRESS) {
    return null;
  }
  const status = await getTokenStatus();
  if (status.hotWalletTokenBalance === null) {
    return null;
  }
  const parsed = Number(status.hotWalletTokenBalance);
  return Number.isFinite(parsed) ? parsed : null;
}

