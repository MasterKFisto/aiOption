import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { logger } from './logger.js';
import { isKnownMainnetToken } from './services/knownTokens.js';

/** Supported trading modes. */
export const TRADING_MODES = ['PAPER', 'TESTNET', 'LIVE'] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

/**
 * Zod schema for the environment variables consumed by the server.
 * Every variable has a safe default, so the server boots even with an
 * empty environment — but bad values fail fast with a clear error.
 */
const envSchema = z.object({
  /**
   * PAPER = simulated trading, TESTNET = real venue test network, LIVE = real funds.
   * Named TRADING_MODE (not MODE) because tooling like Vitest/Vite reserves MODE.
   */
  TRADING_MODE: z.enum(TRADING_MODES).default('PAPER'),
  /** SQLite trading database file path (absolute, or relative to the repository root). */
  DB_PATH: z.string().trim().min(1).default('data/trading.db'),
  /** Base currency used for balances and P/L accounting. */
  /** Base (accounting) currency. Phase 7.1: USDT on Tron — USDC is rejected below. */
  BASE_CURRENCY: z.string().trim().min(1).max(16).default('USDT'),
  /** Fixed trade size in USD for each option position. */
  FIXED_TRADE_SIZE_USD: z.coerce.number().positive().default(10),
  /** Maximum concurrently open classic positions (0 = unlimited, default). */
  MAX_OPEN_POSITIONS: z.coerce.number().int().min(0).default(0),
  /** Daily loss limit as a percentage of account equity. */
  LOSS_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(40),
  /** Explicit daily loss limit alias (Phase 6.4). */
  DAILY_LOSS_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(40),
  /** HTTP server bind address. */
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  /** HTTP server port. */
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Pino log level. */
  LOG_LEVEL: z.string().trim().default('info'),
  /** Comma-separated list of allowed browser origins (CORS). Use * to allow all. */
  CORS_ORIGIN: z.string().trim().default('http://localhost:5173'),
  /** Comma-separated hostnames the API may be addressed as (DNS-rebinding guard). */
  ALLOWED_HOSTS: z.string().trim().default('localhost,127.0.0.1,::1'),
  /** Primary market symbol for the live public price feed (base: USDT). */
  MARKET_SYMBOL: z.string().trim().min(1).default('BTC/USDT'),
  /** Fallback symbol if the primary pair is unavailable on the data source. */
  // BTC/USD is the data source's most liquid pair — an availability-only
  // fallback. All accounting stays in USDT regardless of the price feed.
  FALLBACK_MARKET_SYMBOL: z.string().trim().min(1).default('BTC/USD'),
  /** Live market poll interval in ms (2-5s recommended). */
  MARKET_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(3000),
  /** Tron network mode. */
  TRON_MODE: z.enum(['SIMULATED', 'SHASTA', 'NILE', 'MAINNET']).default('SIMULATED'),
  /** Fixed deposit address (personal use). */
  TRON_DEPOSIT_ADDRESS: z.string().trim().default(''),
  /** Hot wallet address (only relevant for live withdrawals). */
  TRON_HOT_WALLET_ADDRESS: z.string().trim().default(''),
  /** USDT TRC20 contract address for the selected Tron network. */
  TRON_USDT_CONTRACT_ADDRESS: z.string().trim().default(''),
  /** Expected token symbol — informational; test tokens may differ (7.4). */
  TRON_USDT_EXPECTED_SYMBOL: z.string().trim().min(1).max(32).default('USDT'),
  /** Expected token decimals — the actual contract decimals are used (7.4). */
  TRON_USDT_EXPECTED_DECIMALS: z.coerce.number().int().min(0).max(36).default(6),
  /** Allow test tokens whose symbol/decimals differ from the expected USDT (7.4). */
  TRON_USDT_ALLOW_TEST_TOKEN: z.string().trim().default('true'),
  /** Local testing: return simulated token info instead of querying the chain (7.4). */
  TRON_TOKEN_SIMULATE_CONNECTION: z.string().trim().default('false'),
  /** TronGrid API key (optional but recommended for live mode). */
  TRON_GRID_API_KEY: z.string().trim().default(''),
  /** Confirmations required before crediting an incoming USDT transfer. */
  TRON_REQUIRED_CONFIRMATIONS: z.coerce.number().int().min(1).default(12),
  /** Allow real Tron withdrawals (broadcast). Must be explicitly set to true. */
  ENABLE_LIVE_TRON_WITHDRAWALS: z.enum(['true', 'false']).default('false'),
  /**
   * Hot wallet private key — SERVER ONLY, never exposed via any API.
   * Only read when TRON_MODE is live AND ENABLE_LIVE_TRON_WITHDRAWALS=true.
   */
  TRON_HOT_WALLET_PRIVATE_KEY: z.string().trim().default(''),
  /* ---------------------- Phase 7: network + safety gates -------------------- */
  /**
   * Accepted alias of TRADING_MODE (the Phase 7 spec uses MODE). TRADING_MODE
   * wins when both are set; PRODUCTION is treated as LIVE.
   */
  // Free-form on purpose: tooling (Vite/Vitest) may set MODE=test/development.
  // Only PAPER/TESTNET/LIVE/PRODUCTION are honoured; anything else is ignored.
  MODE: z.string().trim().optional(),
  /** Human-readable network name (UI / status). */
  TRON_NETWORK_NAME: z.string().trim().max(64).default(''),
  /** TronGrid-compatible RPC base URL (testnets only; must be https). */
  TRON_RPC_URL: z.string().trim().default(''),
  /** Block explorer base URL for transaction links. */
  TRON_EXPLORER_URL: z.string().trim().default(''),
  /** Required to run in LIVE mode at all ("I_UNDERSTAND_REAL_FUNDS"). */
  LIVE_MODE_CONFIRM: z.string().trim().default(''),
  /** Required for real broadcasts in LIVE mode ("I_UNDERSTAND_LIVE_WITHDRAWALS"). */
  LIVE_WITHDRAWALS_CONFIRM: z.string().trim().default(''),
  /** Admin/maintenance endpoints (UAT reset API). Disabled by default. */
  ENABLE_ADMIN_API: z.enum(['true', 'false']).default('false'),
  /**
   * Production: absolute path of the built web app (apps/web/dist) served by
   * the API on the same port. Empty (dev) = not served (Vite serves the UI).
   */
  WEB_DIST_DIR: z.string().trim().default(''),
  /* ------------------------------ binary options ----------------------------- */
  /** Enable the binary options module (internal-ledger settlement). */
  BINARY_ENABLED: z.enum(['true', 'false']).default('true'),
  /** Live binary trading flag — kept false; settlement is always internal. */
  BINARY_LIVE_TRADING_ENABLED: z.enum(['true', 'false']).default('false'),
  BINARY_MIN_STAKE_USD: z.coerce.number().positive().default(1),
  BINARY_MAX_STAKE_USD: z.coerce.number().positive().default(50),
  BINARY_DEFAULT_STAKE_USD: z.coerce.number().positive().default(10),
  /** Comma-separated allowed durations in seconds. */
  BINARY_ALLOWED_DURATIONS_SECONDS: z.string().trim().default('5,10'),
  /** Comma-separated allowed payout ratios as fractions. */
  BINARY_ALLOWED_PAYOUT_RATIOS: z.string().trim().default('0.5,0.6,0.7,0.8,0.9'),
  /** Max open binary contracts (0 = unlimited, default). */
  BINARY_MAX_OPEN_CONTRACTS: z.coerce.number().int().min(0).default(0),
  /** Ticks older than this are considered stale for entry/settlement. */
  BINARY_MAX_PRICE_STALE_MS: z.coerce.number().int().min(500).default(8000),
  BINARY_SETTLEMENT_SOURCE: z.string().trim().default('INTERNAL_MARKET_FEED'),
  /**
   * Phase 6.5.3: false (default) = conservative — open binary contracts add 0
   * to Unrealized PnL (shown as Open Binary Exposure). true = also show a
   * separately labelled ESTIMATED binary PnL. Overridable from the UI.
   */
  BINARY_SHOW_ESTIMATED_UNREALIZED_PNL: z.enum(['true', 'false']).default('false'),
  /** Settlement scheduler interval in ms. */
  BINARY_SETTLEMENT_INTERVAL_MS: z.coerce.number().int().min(100).max(5000).default(250),
  /* --------------------------- AI binary trading ---------------------------- */
  AI_BINARY_ENABLED: z.enum(['true', 'false']).default('false'),
  AI_BINARY_MODE: z.enum(['DISABLED', 'SIGNAL_ONLY', 'AUTO_EXECUTE']).default('SIGNAL_ONLY'),
  AI_BINARY_ASSET: z.string().trim().default('BTC/USDT'),
  AI_BINARY_STAKE_USD: z.coerce.number().positive().default(10),
  AI_BINARY_DURATION_SECONDS: z.coerce.number().int().positive().default(10),
  AI_BINARY_PAYOUT_RATIO: z.coerce.number().positive().default(0.8),
  AI_BINARY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.65),
  AI_BINARY_EVALUATION_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
  /** Max open AI binary contracts (0 = unlimited, default). */
  AI_BINARY_MAX_OPEN_CONTRACTS: z.coerce.number().int().min(0).default(0),
  AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS: z.coerce.number().int().min(0).default(10000),
  AI_BINARY_COOLDOWN_AFTER_LOSS_MS: z.coerce.number().int().min(0).default(30000),
  AI_BINARY_MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).default(3),
  AI_BINARY_MAX_SESSION_LOSS_USD: z.coerce.number().positive().default(20),
  /** AI binary trades per rolling hour (0 = unlimited, default). */
  AI_BINARY_MAX_TRADES_PER_HOUR: z.coerce.number().int().min(0).default(0),
  AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS: z.coerce.number().int().min(1).default(3),
  AI_BINARY_MAX_PRICE_STALE_MS: z.coerce.number().int().min(500).default(8000),
  AI_BINARY_LIVE_AUTO_TRADING_ENABLED: z.enum(['true', 'false']).default('false'),
  /* ---------------------- classic options (6.4 / 6.5.1) ---------------------- */
  /** Hard maximum classic-option duration: 60 minutes. */
  OPTION_MAX_DURATION_SECONDS: z.coerce.number().int().positive().max(3600).default(3600),
  /** Default classic-option duration: 10 minutes. */
  OPTION_DEFAULT_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
  OPTION_ALLOWED_DURATIONS_SECONDS: z.string().trim().default('60,180,300,600,900,1800,3600'),
  /** Total (all-time) loss limit as % of starting equity; 0 = disabled. */
  TOTAL_LOSS_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(0),
  /* -------------------- classic AI strategy (Phase 6.5.2) -------------------- */
  /** RSI lookback (candles). */
  CLASSIC_AI_RSI_PERIOD: z.coerce.number().int().min(2).max(100).default(14),
  /** RSI above this = overbought → no new CALL. */
  CLASSIC_AI_RSI_OVERBOUGHT: z.coerce.number().min(51).max(99).default(70),
  /** RSI below this = oversold → no new PUT. */
  CLASSIC_AI_RSI_OVERSOLD: z.coerce.number().min(1).max(49).default(30),
  /** Require a NEUTRAL signal before the AI may flip direction (CALL ↔ PUT). */
  CLASSIC_AI_REQUIRE_NEUTRAL_COOLDOWN: z.enum(['true', 'false']).default('true'),
  /** Max consecutive AI classic trades in the same direction. */
  CLASSIC_MAX_CONSECUTIVE_SAME_DIRECTION: z.coerce.number().int().min(1).max(20).default(3),
  /** Cooldown before the same direction is allowed again after the max is hit. */
  CLASSIC_COOLDOWN_AFTER_MAX_CONSECUTIVE_MS: z.coerce.number().int().min(0).max(86_400_000).default(300_000),
  /* ---------------------- market simulator (Phase 6.5.2) --------------------- */
  /** Per-candle pull back toward the long-term mean (0 = random walk, 1 = snap). */
  SIMULATOR_MEAN_REVERSION_STRENGTH: z.coerce.number().min(0).max(1).default(0.05),
  /** Long-run per-candle log-return volatility (0.002 = 0.2%). */
  SIMULATOR_BASE_VOLATILITY: z.coerce.number().positive().max(0.1).default(0.002),
  /** Simulated candle interval (default 5 minutes, matching 1–60 min options). */
  SIMULATOR_CANDLE_INTERVAL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
  /** Long-term mean price for simulated BTC. */
  SIMULATOR_BTC_MEAN_PRICE: z.coerce.number().positive().default(60_000),
  OPTION_SETTLEMENT_GRACE_MS: z.coerce.number().int().min(0).default(5000),
  OPTION_MAX_PRICE_STALE_MS: z.coerce.number().int().min(500).default(8000),
  MAX_OPTION_STAKE_USD: z.coerce.number().positive().default(100),
  MIN_OPTION_STAKE_USD: z.coerce.number().positive().default(1),
  DEFAULT_OPTION_STAKE_USD: z.coerce.number().positive().default(10),
  /* -------------------------- Tron withdrawal fees --------------------------- */
  TRON_WITHDRAWAL_FEE_POLICY: z
    .enum(['HOT_WALLET_PAYS', 'DEDUCT_USDT_FROM_WITHDRAWAL', 'BLOCK_IF_INSUFFICIENT'])
    .default('HOT_WALLET_PAYS'),
  TRON_WITHDRAWAL_FEE_ESTIMATE_TRX: z.coerce.number().min(0).default(30),
  TRON_USD_TRX_PRICE: z.coerce.number().positive().default(0.12),
  TRON_MIN_TRX_BALANCE_FOR_WITHDRAWAL: z.coerce.number().min(0).default(50),
  ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT: z.enum(['true', 'false']).default('false'),
  /* --------------------------- AI profit target ------------------------------ */
  AI_BINARY_PROFIT_TARGET_ENABLED: z.enum(['true', 'false']).default('true'),
  AI_BINARY_PROFIT_TARGET_USD: z.coerce.number().positive().default(50),
  AI_BINARY_DAILY_PROFIT_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(20),
  AI_BINARY_STOP_ON_PROFIT_TARGET: z.enum(['true', 'false']).default('true'),
  /* ---------------------- binary session gain limit (6.5) -------------------- */
  BINARY_SESSION_GAIN_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  BINARY_MAX_SESSION_GAIN_USDT: z.coerce.number().positive().default(50),
  BINARY_MAX_SESSION_GAIN_PERCENT: z.coerce.number().min(0).max(100).default(0),
  BINARY_SESSION_RESET_ON_START: z.enum(['true', 'false']).default('true'),
  /* ----------------------- TRX fee wallet deposits (6.5) --------------------- */
  TRON_FEE_WALLET_ADDRESS: z.string().trim().default(''),
  TRON_ACCEPT_TRX_DEPOSITS: z.enum(['true', 'false']).default('true'),
  TRON_MIN_TRX_FEE_RESERVE: z.coerce.number().min(0).default(50),
  TRON_FEE_DEPOSIT_REQUIRED_CONFIRMATIONS: z.coerce.number().int().min(1).default(20),
}).superRefine((env, ctx) => {
  // AI duration/ratio must stay within the Phase 6.2 allowed sets, otherwise
  // every AI open would be rejected by the binary service at runtime.
  const allowedDurations = parseNumberList(env.BINARY_ALLOWED_DURATIONS_SECONDS);
  if (!allowedDurations.includes(env.AI_BINARY_DURATION_SECONDS)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_BINARY_DURATION_SECONDS'],
      message: `must be one of the allowed durations [${allowedDurations.join(', ')}]`,
    });
  }
  const allowedRatios = parseNumberList(env.BINARY_ALLOWED_PAYOUT_RATIOS);
  if (!allowedRatios.includes(env.AI_BINARY_PAYOUT_RATIO)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_BINARY_PAYOUT_RATIO'],
      message: `must be one of the allowed payout ratios [${allowedRatios.join(', ')}]`,
    });
  }
  // Classic options (6.5.1): every allowed duration must be <= the maximum,
  // and the default must be one of the allowed durations.
  const optionDurations = parseNumberList(env.OPTION_ALLOWED_DURATIONS_SECONDS);
  if (optionDurations.length === 0 || optionDurations.some((d) => d > env.OPTION_MAX_DURATION_SECONDS)) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPTION_ALLOWED_DURATIONS_SECONDS'],
      message: `must be a non-empty list with every value <= OPTION_MAX_DURATION_SECONDS (${env.OPTION_MAX_DURATION_SECONDS})`,
    });
  }
  if (!optionDurations.includes(env.OPTION_DEFAULT_DURATION_SECONDS)) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPTION_DEFAULT_DURATION_SECONDS'],
      message: `must be one of the allowed durations [${optionDurations.join(', ')}]`,
    });
  }

  /* ----------------------- Phase 7: network safety gates ---------------------- */
  // Phase 7.1: USDC is no longer supported on Tron. Abort loudly on USDC
  // (deprecation) or any other unsupported base currency — never silently map.
  if (env.BASE_CURRENCY.toUpperCase() === 'USDC') {
    ctx.addIssue({
      code: 'custom',
      path: ['BASE_CURRENCY'],
      message:
        'USDC is no longer supported on the Tron network — set BASE_CURRENCY=USDT ' +
        '(existing USDC rows are migrated automatically on startup)',
    });
  } else if (env.BASE_CURRENCY !== 'USDT') {
    ctx.addIssue({
      code: 'custom',
      path: ['BASE_CURRENCY'],
      message: `unsupported base currency "${env.BASE_CURRENCY}" — only USDT (Tron TRC20) is supported`,
    });
  }
  const tradingModeExplicit = process.env['TRADING_MODE'] !== undefined;
  const alias = parseModeAlias(env.MODE);
  if (tradingModeExplicit && alias !== null && alias !== env.TRADING_MODE) {
    ctx.addIssue({
      code: 'custom',
      path: ['MODE'],
      message: `MODE=${env.MODE} conflicts with TRADING_MODE=${env.TRADING_MODE} — set only one`,
    });
  }
  const mode = effectiveMode(env.TRADING_MODE, env.MODE, tradingModeExplicit);
  if (mode === 'TESTNET' && env.TRON_MODE !== 'SHASTA' && env.TRON_MODE !== 'NILE') {
    ctx.addIssue({
      code: 'custom',
      path: ['TRON_MODE'],
      message: `MODE=TESTNET requires TRON_MODE=SHASTA or NILE (got ${env.TRON_MODE}) — mainnet is never allowed in testnet mode`,
    });
  }
  if (mode === 'LIVE' && env.LIVE_MODE_CONFIRM !== LIVE_MODE_CONFIRMATION) {
    ctx.addIssue({
      code: 'custom',
      path: ['LIVE_MODE_CONFIRM'],
      message: `MODE=LIVE/PRODUCTION requires LIVE_MODE_CONFIRM=${LIVE_MODE_CONFIRMATION}`,
    });
  }
  if (
    mode === 'LIVE' &&
    env.ENABLE_LIVE_TRON_WITHDRAWALS === 'true' &&
    env.LIVE_WITHDRAWALS_CONFIRM !== LIVE_WITHDRAWALS_CONFIRMATION
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['LIVE_WITHDRAWALS_CONFIRM'],
      message: `ENABLE_LIVE_TRON_WITHDRAWALS=true in LIVE mode requires LIVE_WITHDRAWALS_CONFIRM=${LIVE_WITHDRAWALS_CONFIRMATION}`,
    });
  }
  if (env.TRON_RPC_URL !== '' && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(env.TRON_RPC_URL)) {
    ctx.addIssue({ code: 'custom', path: ['TRON_RPC_URL'], message: 'must be an https:// URL' });
  }
  if (env.TRON_EXPLORER_URL !== '' && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(env.TRON_EXPLORER_URL)) {
    ctx.addIssue({ code: 'custom', path: ['TRON_EXPLORER_URL'], message: 'must be an https:// URL' });
  }
  if (env.TRON_MODE !== 'MAINNET' && isMainnetTronGridHost(env.TRON_RPC_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRON_RPC_URL'],
      message: 'TRON_RPC_URL points at Tron MAINNET while TRON_MODE is not MAINNET',
    });
  }
});

export const LIVE_MODE_CONFIRMATION = 'I_UNDERSTAND_REAL_FUNDS';
export const LIVE_WITHDRAWALS_CONFIRMATION = 'I_UNDERSTAND_LIVE_WITHDRAWALS';

/** True when the URL's host is the Tron MAINNET TronGrid endpoint. */
function isMainnetTronGridHost(raw: string): boolean {
  if (raw === '') {
    return false;
  }
  try {
    return new URL(raw).hostname.toLowerCase() === 'api.trongrid.io';
  } catch {
    return false;
  }
}

/** Maps the MODE alias; unknown values (e.g. Vitest's "test") → null. */
function parseModeAlias(value: string | undefined): TradingMode | null {
  switch ((value ?? '').toUpperCase()) {
    case 'PAPER':
      return 'PAPER';
    case 'TESTNET':
      return 'TESTNET';
    case 'LIVE':
    case 'PRODUCTION':
      return 'LIVE';
    default:
      return null;
  }
}

/** TRADING_MODE wins if explicitly set; otherwise MODE (PRODUCTION → LIVE). */
function effectiveMode(
  tradingMode: TradingMode,
  modeAlias: string | undefined,
  tradingModeExplicit: boolean,
): TradingMode {
  const alias = parseModeAlias(modeAlias);
  if (tradingModeExplicit || alias === null) {
    return tradingMode;
  }
  return alias;
}

const result = envSchema.safeParse(process.env);
if (!result.success) {
  logger.fatal({ issues: result.error.issues }, 'Invalid environment configuration');
  process.exit(1);
}
const env = result.data;

// Resolve paths relative to the repository root so DB_PATH works
// regardless of the current working directory (src/ and dist/).
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');
const fromRepoRoot = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(repoRoot, p));

/**
 * A price can only be "fresh" if the stale threshold leaves room for at least
 * two polls plus network latency. Bug fixed (Phase 6.5.2): with poll = 3000 ms
 * and stale = 3000 ms every normal poll delay marked the feed stale, which
 * blocked trades and refunded expiring options. Raises too-tight values.
 */
const minFreshWindowMs = 2 * env.MARKET_POLL_INTERVAL_MS + 2_000;
function freshWindow(name: string, configured: number): number {
  if (configured >= minFreshWindowMs) {
    return configured;
  }
  logger.warn(
    { name, configured, effective: minFreshWindowMs, pollIntervalMs: env.MARKET_POLL_INTERVAL_MS },
    'stale-price threshold too tight for the poll interval — raised automatically',
  );
  return minFreshWindowMs;
}

/** Validated, typed runtime configuration. */
const effectiveTradingMode = effectiveMode(
  env.TRADING_MODE,
  env.MODE,
  process.env['TRADING_MODE'] !== undefined,
);
export const config = {
  MODE: effectiveTradingMode,
  DB_PATH: fromRepoRoot(env.DB_PATH),
  BASE_CURRENCY: env.BASE_CURRENCY,
  FIXED_TRADE_SIZE_USD: env.FIXED_TRADE_SIZE_USD,
  MAX_OPEN_POSITIONS: env.MAX_OPEN_POSITIONS,
  LOSS_LIMIT_PERCENT: env.LOSS_LIMIT_PERCENT,
  HOST: env.HOST,
  PORT: env.PORT,
  LOG_LEVEL: env.LOG_LEVEL,
  /** Allowed CORS origins, parsed from the comma-separated env value. */
  CORS_ORIGINS: env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  ALLOWED_HOSTS: env.ALLOWED_HOSTS.split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0),
  MARKET_SYMBOL: env.MARKET_SYMBOL,
  FALLBACK_MARKET_SYMBOL: env.FALLBACK_MARKET_SYMBOL,
  MARKET_POLL_INTERVAL_MS: env.MARKET_POLL_INTERVAL_MS,
  TRON_MODE: env.TRON_MODE,
  /**
   * True when fake/simulated funds may be credited to the INTERNAL ledger:
   * PAPER mode, TESTNET mode (startup-guaranteed to point at a test network),
   * or the SIMULATED Tron service. Never true in LIVE.
   */
  SIMULATION_ALLOWED:
    effectiveTradingMode === 'PAPER' ||
    effectiveTradingMode === 'TESTNET' ||
    env.TRON_MODE === 'SIMULATED',
  TRON_DEPOSIT_ADDRESS: env.TRON_DEPOSIT_ADDRESS,
  TRON_HOT_WALLET_ADDRESS: env.TRON_HOT_WALLET_ADDRESS,
  TRON_USDT_CONTRACT_ADDRESS: env.TRON_USDT_CONTRACT_ADDRESS,
  TRON_USDT_EXPECTED_SYMBOL: env.TRON_USDT_EXPECTED_SYMBOL,
  TRON_USDT_EXPECTED_DECIMALS: env.TRON_USDT_EXPECTED_DECIMALS,
  TRON_USDT_ALLOW_TEST_TOKEN: env.TRON_USDT_ALLOW_TEST_TOKEN === 'true',
  TRON_TOKEN_SIMULATE_CONNECTION: env.TRON_TOKEN_SIMULATE_CONNECTION === 'true',
  TRON_GRID_API_KEY: env.TRON_GRID_API_KEY,
  TRON_REQUIRED_CONFIRMATIONS: env.TRON_REQUIRED_CONFIRMATIONS,
  /**
   * Broadcasting real withdrawals needs BOTH the flag AND a server-side key.
   * An empty TRON_HOT_WALLET_PRIVATE_KEY always disables broadcasting.
   */
  ENABLE_LIVE_TRON_WITHDRAWALS:
    env.ENABLE_LIVE_TRON_WITHDRAWALS === 'true' && env.TRON_HOT_WALLET_PRIVATE_KEY !== '',
  TRON_HOT_WALLET_PRIVATE_KEY: env.TRON_HOT_WALLET_PRIVATE_KEY,
  TRON_NETWORK_NAME: env.TRON_NETWORK_NAME,
  TRON_RPC_URL: env.TRON_RPC_URL.replace(/\/+$/, ''),
  TRON_EXPLORER_URL: env.TRON_EXPLORER_URL.replace(/\/+$/, ''),
  ENABLE_ADMIN_API: env.ENABLE_ADMIN_API === 'true',
  WEB_DIST_DIR: env.WEB_DIST_DIR ? fromRepoRoot(env.WEB_DIST_DIR) : '',
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  BINARY_ENABLED: env.BINARY_ENABLED === 'true',
  BINARY_LIVE_TRADING_ENABLED: env.BINARY_LIVE_TRADING_ENABLED === 'true',
  BINARY_MIN_STAKE_USD: env.BINARY_MIN_STAKE_USD,
  BINARY_MAX_STAKE_USD: env.BINARY_MAX_STAKE_USD,
  BINARY_DEFAULT_STAKE_USD: env.BINARY_DEFAULT_STAKE_USD,
  BINARY_ALLOWED_DURATIONS_SECONDS: parseNumberList(env.BINARY_ALLOWED_DURATIONS_SECONDS),
  BINARY_ALLOWED_PAYOUT_RATIOS: parseNumberList(env.BINARY_ALLOWED_PAYOUT_RATIOS),
  BINARY_MAX_OPEN_CONTRACTS: env.BINARY_MAX_OPEN_CONTRACTS,
  BINARY_MAX_PRICE_STALE_MS: freshWindow('BINARY_MAX_PRICE_STALE_MS', env.BINARY_MAX_PRICE_STALE_MS),
  BINARY_SETTLEMENT_SOURCE: env.BINARY_SETTLEMENT_SOURCE,
  BINARY_SHOW_ESTIMATED_UNREALIZED_PNL: env.BINARY_SHOW_ESTIMATED_UNREALIZED_PNL === 'true',
  BINARY_SETTLEMENT_INTERVAL_MS: env.BINARY_SETTLEMENT_INTERVAL_MS,
  AI_BINARY_ENABLED: env.AI_BINARY_ENABLED === 'true',
  AI_BINARY_MODE: env.AI_BINARY_MODE,
  AI_BINARY_ASSET: env.AI_BINARY_ASSET,
  AI_BINARY_STAKE_USD: env.AI_BINARY_STAKE_USD,
  AI_BINARY_DURATION_SECONDS: env.AI_BINARY_DURATION_SECONDS,
  AI_BINARY_PAYOUT_RATIO: env.AI_BINARY_PAYOUT_RATIO,
  AI_BINARY_MIN_CONFIDENCE: env.AI_BINARY_MIN_CONFIDENCE,
  AI_BINARY_EVALUATION_INTERVAL_MS: env.AI_BINARY_EVALUATION_INTERVAL_MS,
  AI_BINARY_MAX_OPEN_CONTRACTS: env.AI_BINARY_MAX_OPEN_CONTRACTS,
  AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS: env.AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS,
  AI_BINARY_COOLDOWN_AFTER_LOSS_MS: env.AI_BINARY_COOLDOWN_AFTER_LOSS_MS,
  AI_BINARY_MAX_CONSECUTIVE_LOSSES: env.AI_BINARY_MAX_CONSECUTIVE_LOSSES,
  AI_BINARY_MAX_SESSION_LOSS_USD: env.AI_BINARY_MAX_SESSION_LOSS_USD,
  AI_BINARY_MAX_TRADES_PER_HOUR: env.AI_BINARY_MAX_TRADES_PER_HOUR,
  AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS: env.AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS,
  AI_BINARY_MAX_PRICE_STALE_MS: freshWindow('AI_BINARY_MAX_PRICE_STALE_MS', env.AI_BINARY_MAX_PRICE_STALE_MS),
  AI_BINARY_LIVE_AUTO_TRADING_ENABLED: env.AI_BINARY_LIVE_AUTO_TRADING_ENABLED === 'true',
  OPTION_MAX_DURATION_SECONDS: env.OPTION_MAX_DURATION_SECONDS,
  OPTION_DEFAULT_DURATION_SECONDS: env.OPTION_DEFAULT_DURATION_SECONDS,
  OPTION_ALLOWED_DURATIONS_SECONDS: [...new Set(parseNumberList(env.OPTION_ALLOWED_DURATIONS_SECONDS))].sort(
    (a, b) => a - b,
  ),
  TOTAL_LOSS_LIMIT_PERCENT: env.TOTAL_LOSS_LIMIT_PERCENT,
  DAILY_LOSS_LIMIT_PERCENT: env.DAILY_LOSS_LIMIT_PERCENT,
  CLASSIC_AI_RSI_PERIOD: env.CLASSIC_AI_RSI_PERIOD,
  CLASSIC_AI_RSI_OVERBOUGHT: env.CLASSIC_AI_RSI_OVERBOUGHT,
  CLASSIC_AI_RSI_OVERSOLD: env.CLASSIC_AI_RSI_OVERSOLD,
  CLASSIC_AI_REQUIRE_NEUTRAL_COOLDOWN: env.CLASSIC_AI_REQUIRE_NEUTRAL_COOLDOWN === 'true',
  CLASSIC_MAX_CONSECUTIVE_SAME_DIRECTION: env.CLASSIC_MAX_CONSECUTIVE_SAME_DIRECTION,
  CLASSIC_COOLDOWN_AFTER_MAX_CONSECUTIVE_MS: env.CLASSIC_COOLDOWN_AFTER_MAX_CONSECUTIVE_MS,
  SIMULATOR_MEAN_REVERSION_STRENGTH: env.SIMULATOR_MEAN_REVERSION_STRENGTH,
  SIMULATOR_BASE_VOLATILITY: env.SIMULATOR_BASE_VOLATILITY,
  SIMULATOR_CANDLE_INTERVAL_MS: env.SIMULATOR_CANDLE_INTERVAL_MS,
  SIMULATOR_BTC_MEAN_PRICE: env.SIMULATOR_BTC_MEAN_PRICE,
  OPTION_SETTLEMENT_GRACE_MS: env.OPTION_SETTLEMENT_GRACE_MS,
  OPTION_MAX_PRICE_STALE_MS: freshWindow('OPTION_MAX_PRICE_STALE_MS', env.OPTION_MAX_PRICE_STALE_MS),
  MAX_OPTION_STAKE_USD: env.MAX_OPTION_STAKE_USD,
  MIN_OPTION_STAKE_USD: env.MIN_OPTION_STAKE_USD,
  DEFAULT_OPTION_STAKE_USD: env.DEFAULT_OPTION_STAKE_USD,
  TRON_WITHDRAWAL_FEE_POLICY: env.TRON_WITHDRAWAL_FEE_POLICY,
  TRON_WITHDRAWAL_FEE_ESTIMATE_TRX: env.TRON_WITHDRAWAL_FEE_ESTIMATE_TRX,
  TRON_USD_TRX_PRICE: env.TRON_USD_TRX_PRICE,
  TRON_MIN_TRX_BALANCE_FOR_WITHDRAWAL: env.TRON_MIN_TRX_BALANCE_FOR_WITHDRAWAL,
  ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT: env.ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT === 'true',
  AI_BINARY_PROFIT_TARGET_ENABLED: env.AI_BINARY_PROFIT_TARGET_ENABLED === 'true',
  AI_BINARY_PROFIT_TARGET_USD: env.AI_BINARY_PROFIT_TARGET_USD,
  AI_BINARY_DAILY_PROFIT_LIMIT_PERCENT: env.AI_BINARY_DAILY_PROFIT_LIMIT_PERCENT,
  AI_BINARY_STOP_ON_PROFIT_TARGET: env.AI_BINARY_STOP_ON_PROFIT_TARGET === 'true',
  BINARY_SESSION_GAIN_LIMIT_ENABLED: env.BINARY_SESSION_GAIN_LIMIT_ENABLED === 'true',
  BINARY_MAX_SESSION_GAIN_USDT: env.BINARY_MAX_SESSION_GAIN_USDT,
  BINARY_MAX_SESSION_GAIN_PERCENT: env.BINARY_MAX_SESSION_GAIN_PERCENT,
  BINARY_SESSION_RESET_ON_START: env.BINARY_SESSION_RESET_ON_START === 'true',
  TRON_FEE_WALLET_ADDRESS: env.TRON_FEE_WALLET_ADDRESS,
  TRON_ACCEPT_TRX_DEPOSITS: env.TRON_ACCEPT_TRX_DEPOSITS === 'true',
  TRON_MIN_TRX_FEE_RESERVE: env.TRON_MIN_TRX_FEE_RESERVE,
  TRON_FEE_DEPOSIT_REQUIRED_CONFIRMATIONS: env.TRON_FEE_DEPOSIT_REQUIRED_CONFIRMATIONS,
} as const;

/** Parses a comma-separated list of numbers ("" → []). */
function parseNumberList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/* ------------------- Phase 7.4: token startup warnings -------------------- */
// Non-fatal by design — /api/tron/token-status surfaces the same state.
if (config.TRON_MODE !== 'SIMULATED' && !config.TRON_USDT_CONTRACT_ADDRESS) {
  logger.warn(
    config.TRON_MODE === 'NILE'
      ? 'USDT token contract is not configured. Deposits and withdrawals using USDT will not work until the Nile Testnet USDT token contract is configured.'
      : `USDT token contract is not configured (TRON_USDT_CONTRACT_ADDRESS) — token deposits/withdrawals are unavailable on ${config.TRON_MODE}`,
  );
}
if (
  config.TRON_MODE !== 'MAINNET' &&
  config.TRON_USDT_CONTRACT_ADDRESS &&
  isKnownMainnetToken(config.TRON_USDT_CONTRACT_ADDRESS)
) {
  logger.warn(
    { contract: config.TRON_USDT_CONTRACT_ADDRESS, tronMode: config.TRON_MODE },
    'configured USDT token contract is a known MAINNET token — wrong network; deposits will not be detected',
  );
}

export type AppConfig = typeof config;
