import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { logger } from './logger.js';

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
  BASE_CURRENCY: z.string().trim().min(1).max(16).default('USDC'),
  /** Fixed trade size in USD for each option position. */
  FIXED_TRADE_SIZE_USD: z.coerce.number().positive().default(10),
  /** Maximum number of concurrently open positions. */
  MAX_OPEN_POSITIONS: z.coerce.number().int().min(1).default(5),
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
  /** Primary market symbol for the live public price feed. */
  MARKET_SYMBOL: z.string().trim().min(1).default('BTC/USDC'),
  /** Fallback symbol if the primary pair is unavailable on the data source. */
  FALLBACK_MARKET_SYMBOL: z.string().trim().min(1).default('BTC/USDT'),
  /** Live market poll interval in ms (2-5s recommended). */
  MARKET_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(3000),
  /** Tron network mode. */
  TRON_MODE: z.enum(['SIMULATED', 'SHASTA', 'NILE', 'MAINNET']).default('SIMULATED'),
  /** Fixed deposit address (personal use). */
  TRON_DEPOSIT_ADDRESS: z.string().trim().default(''),
  /** Hot wallet address (only relevant for live withdrawals). */
  TRON_HOT_WALLET_ADDRESS: z.string().trim().default(''),
  /** USDC TRC20 contract address for the selected Tron network. */
  TRON_USDC_CONTRACT_ADDRESS: z.string().trim().default(''),
  /** TronGrid API key (optional but recommended for live mode). */
  TRON_GRID_API_KEY: z.string().trim().default(''),
  /** Confirmations required before crediting an incoming USDC transfer. */
  TRON_REQUIRED_CONFIRMATIONS: z.coerce.number().int().min(1).default(12),
  /** Allow real Tron withdrawals (broadcast). Must be explicitly set to true. */
  ENABLE_LIVE_TRON_WITHDRAWALS: z.enum(['true', 'false']).default('false'),
  /**
   * Hot wallet private key — SERVER ONLY, never exposed via any API.
   * Only read when TRON_MODE is live AND ENABLE_LIVE_TRON_WITHDRAWALS=true.
   */
  TRON_HOT_WALLET_PRIVATE_KEY: z.string().trim().default(''),
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
  BINARY_MAX_OPEN_CONTRACTS: z.coerce.number().int().min(1).default(3),
  /** Ticks older than this are considered stale for entry/settlement. */
  BINARY_MAX_PRICE_STALE_MS: z.coerce.number().int().min(500).default(3000),
  BINARY_SETTLEMENT_SOURCE: z.string().trim().default('INTERNAL_MARKET_FEED'),
  /** Settlement scheduler interval in ms. */
  BINARY_SETTLEMENT_INTERVAL_MS: z.coerce.number().int().min(100).max(5000).default(250),
  /* --------------------------- AI binary trading ---------------------------- */
  AI_BINARY_ENABLED: z.enum(['true', 'false']).default('false'),
  AI_BINARY_MODE: z.enum(['DISABLED', 'SIGNAL_ONLY', 'AUTO_EXECUTE']).default('SIGNAL_ONLY'),
  AI_BINARY_ASSET: z.string().trim().default('BTC/USDC'),
  AI_BINARY_STAKE_USD: z.coerce.number().positive().default(10),
  AI_BINARY_DURATION_SECONDS: z.coerce.number().int().positive().default(10),
  AI_BINARY_PAYOUT_RATIO: z.coerce.number().positive().default(0.8),
  AI_BINARY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.65),
  AI_BINARY_EVALUATION_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
  AI_BINARY_MAX_OPEN_CONTRACTS: z.coerce.number().int().min(1).default(1),
  AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS: z.coerce.number().int().min(0).default(10000),
  AI_BINARY_COOLDOWN_AFTER_LOSS_MS: z.coerce.number().int().min(0).default(30000),
  AI_BINARY_MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).default(3),
  AI_BINARY_MAX_SESSION_LOSS_USD: z.coerce.number().positive().default(20),
  AI_BINARY_MAX_TRADES_PER_HOUR: z.coerce.number().int().min(1).default(30),
  AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS: z.coerce.number().int().min(1).default(3),
  AI_BINARY_MAX_PRICE_STALE_MS: z.coerce.number().int().min(500).default(3000),
  AI_BINARY_LIVE_AUTO_TRADING_ENABLED: z.enum(['true', 'false']).default('false'),
  /* ---------------------- classic options (6.4 / 6.5.1) ---------------------- */
  /** Hard maximum classic-option duration: 60 minutes. */
  OPTION_MAX_DURATION_SECONDS: z.coerce.number().int().positive().max(3600).default(3600),
  /** Default classic-option duration: 10 minutes. */
  OPTION_DEFAULT_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
  OPTION_ALLOWED_DURATIONS_SECONDS: z.string().trim().default('60,180,300,600,900,1800,3600'),
  /** Total (all-time) loss limit as % of starting equity; 0 = disabled. */
  TOTAL_LOSS_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(0),
  OPTION_SETTLEMENT_GRACE_MS: z.coerce.number().int().min(0).default(5000),
  OPTION_MAX_PRICE_STALE_MS: z.coerce.number().int().min(500).default(3000),
  MAX_OPTION_STAKE_USD: z.coerce.number().positive().default(100),
  MIN_OPTION_STAKE_USD: z.coerce.number().positive().default(1),
  DEFAULT_OPTION_STAKE_USD: z.coerce.number().positive().default(10),
  /* -------------------------- Tron withdrawal fees --------------------------- */
  TRON_WITHDRAWAL_FEE_POLICY: z
    .enum(['HOT_WALLET_PAYS', 'DEDUCT_USDC_FROM_WITHDRAWAL', 'BLOCK_IF_INSUFFICIENT'])
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
  BINARY_MAX_SESSION_GAIN_USDC: z.coerce.number().positive().default(50),
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
});

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

/** Validated, typed runtime configuration. */
export const config = {
  MODE: env.TRADING_MODE,
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
  TRON_DEPOSIT_ADDRESS: env.TRON_DEPOSIT_ADDRESS,
  TRON_HOT_WALLET_ADDRESS: env.TRON_HOT_WALLET_ADDRESS,
  TRON_USDC_CONTRACT_ADDRESS: env.TRON_USDC_CONTRACT_ADDRESS,
  TRON_GRID_API_KEY: env.TRON_GRID_API_KEY,
  TRON_REQUIRED_CONFIRMATIONS: env.TRON_REQUIRED_CONFIRMATIONS,
  ENABLE_LIVE_TRON_WITHDRAWALS: env.ENABLE_LIVE_TRON_WITHDRAWALS === 'true',
  TRON_HOT_WALLET_PRIVATE_KEY: env.TRON_HOT_WALLET_PRIVATE_KEY,
  BINARY_ENABLED: env.BINARY_ENABLED === 'true',
  BINARY_LIVE_TRADING_ENABLED: env.BINARY_LIVE_TRADING_ENABLED === 'true',
  BINARY_MIN_STAKE_USD: env.BINARY_MIN_STAKE_USD,
  BINARY_MAX_STAKE_USD: env.BINARY_MAX_STAKE_USD,
  BINARY_DEFAULT_STAKE_USD: env.BINARY_DEFAULT_STAKE_USD,
  BINARY_ALLOWED_DURATIONS_SECONDS: parseNumberList(env.BINARY_ALLOWED_DURATIONS_SECONDS),
  BINARY_ALLOWED_PAYOUT_RATIOS: parseNumberList(env.BINARY_ALLOWED_PAYOUT_RATIOS),
  BINARY_MAX_OPEN_CONTRACTS: env.BINARY_MAX_OPEN_CONTRACTS,
  BINARY_MAX_PRICE_STALE_MS: env.BINARY_MAX_PRICE_STALE_MS,
  BINARY_SETTLEMENT_SOURCE: env.BINARY_SETTLEMENT_SOURCE,
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
  AI_BINARY_MAX_PRICE_STALE_MS: env.AI_BINARY_MAX_PRICE_STALE_MS,
  AI_BINARY_LIVE_AUTO_TRADING_ENABLED: env.AI_BINARY_LIVE_AUTO_TRADING_ENABLED === 'true',
  OPTION_MAX_DURATION_SECONDS: env.OPTION_MAX_DURATION_SECONDS,
  OPTION_DEFAULT_DURATION_SECONDS: env.OPTION_DEFAULT_DURATION_SECONDS,
  OPTION_ALLOWED_DURATIONS_SECONDS: [...new Set(parseNumberList(env.OPTION_ALLOWED_DURATIONS_SECONDS))].sort(
    (a, b) => a - b,
  ),
  TOTAL_LOSS_LIMIT_PERCENT: env.TOTAL_LOSS_LIMIT_PERCENT,
  DAILY_LOSS_LIMIT_PERCENT: env.DAILY_LOSS_LIMIT_PERCENT,
  OPTION_SETTLEMENT_GRACE_MS: env.OPTION_SETTLEMENT_GRACE_MS,
  OPTION_MAX_PRICE_STALE_MS: env.OPTION_MAX_PRICE_STALE_MS,
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
  BINARY_MAX_SESSION_GAIN_USDC: env.BINARY_MAX_SESSION_GAIN_USDC,
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

export type AppConfig = typeof config;
