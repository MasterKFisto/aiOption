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
  /** PAPER = simulated trading, TESTNET = real venue test network, LIVE = real funds. */
  MODE: z.enum(TRADING_MODES).default('PAPER'),
  /** SQLite database file path (absolute, or relative to the repository root). */
  DB_PATH: z.string().trim().min(1).default('data/aioption.db'),
  /** Base currency used for balances and P/L accounting. */
  BASE_CURRENCY: z.string().trim().min(1).max(16).default('USD'),
  /** Fixed trade size in USD for each option position. */
  FIXED_TRADE_SIZE_USD: z.coerce.number().positive().default(100),
  /** Maximum number of concurrently open positions. */
  MAX_OPEN_POSITIONS: z.coerce.number().int().min(1).default(5),
  /** Daily loss limit as a percentage of account equity. */
  LOSS_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(5),
  /** HTTP server bind address. */
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  /** HTTP server port. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Pino log level. */
  LOG_LEVEL: z.string().trim().default('info'),
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
  MODE: env.MODE,
  DB_PATH: fromRepoRoot(env.DB_PATH),
  BASE_CURRENCY: env.BASE_CURRENCY,
  FIXED_TRADE_SIZE_USD: env.FIXED_TRADE_SIZE_USD,
  MAX_OPEN_POSITIONS: env.MAX_OPEN_POSITIONS,
  LOSS_LIMIT_PERCENT: env.LOSS_LIMIT_PERCENT,
  HOST: env.HOST,
  PORT: env.PORT,
  LOG_LEVEL: env.LOG_LEVEL,
} as const;

export type AppConfig = typeof config;
