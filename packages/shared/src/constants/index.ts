export const ASSETS = ['USDC', 'ETH', 'BTC'] as const;
export const SUPPORTED_ASSETS = ['USDC', 'ETH', 'BTC'] as const;
export const BASE_ASSET = 'USDC' as const;

export const DEFAULT_TRADING_SETTINGS = {
  maxTradeSizeUsd: '10',
  dailyLossLimitUsd: '20',
  weeklyLossLimitUsd: '50',
  maxOpenPositions: 3,
  reinvestProfits: true,
  minAiConfidence: 0.6,
  maxSlippagePercent: 2,
  maxSpreadPercent: 5,
  stopLossPercent: 50,
  takeProfitPercent: 100,
  continuousTrading: false,
  allowedAssets: ['USDC', 'ETH', 'BTC'] as const,
  allowedOptionTypes: ['CALL', 'PUT'] as const,
} as const;

export const WALLET_MODES = ['PAPER', 'METAMASK', 'SMART_WALLET'] as const;
export const ORDER_STATUSES = [
  'PENDING',
  'RISK_APPROVED',
  'RISK_REJECTED',
  'SUBMITTED',
  'FILLED',
  'CANCELED',
  'FAILED',
] as const;

export const POSITION_STATUSES = ['OPEN', 'CLOSED', 'EXPIRED', 'CANCELED'] as const;
export const WITHDRAWAL_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export const LEDGER_EVENT_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL_REQUEST',
  'WITHDRAWAL_COMPLETE',
  'OPTION_PREMIUM_PAID',
  'OPTION_PREMIUM_RECEIVED',
  'TRADING_FEE',
  'PLATFORM_FEE',
  'OPTION_SETTLEMENT_PROFIT',
  'OPTION_SETTLEMENT_LOSS',
  'ADJUSTMENT',
] as const;

export const AI_STRATEGIES = ['long_call', 'long_put', 'covered_call', 'cash_secured_put'] as const;
export const AI_REASONS = [
  'momentum',
  'volatility',
  'order_book_imbalance',
  'trend_signal',
  'mean_reversion',
  'support_resistance',
  'funding_rate',
  'open_interest',
] as const;

export const TRADING_LOOP_INTERVAL_MS = 30_000;
export const MAX_RETRY_ATTEMPTS = 3;
export const LEDGER_DECIMALS = 6;
export const MAX_WITHDRAWAL_AMOUNT_USD = 1000;
export const MIN_DEPOSIT_AMOUNT_USD = 1;
export const JWT_EXPIRES_IN = '7d';
export const BCRYPT_ROUNDS = 10;
export const API_PREFIX = '/api/v1';