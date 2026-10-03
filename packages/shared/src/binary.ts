/**
 * Short-duration binary options (internal ledger settlement — never on-chain).
 */

export type BinaryDirection = 'UP' | 'DOWN';

export type BinaryContractStatus = 'OPEN' | 'SETTLED' | 'CANCELLED' | 'ERROR';

export type BinaryResult = 'WIN' | 'LOSE' | 'REFUND' | null;

/** An internal-ledger binary option contract (5s / 10s durations). */
export interface BinaryContract {
  id: number;
  asset: string;
  direction: BinaryDirection;
  stakeUsd: number;
  /** Profit ratio on win, as a fraction (0.8 = 80%). */
  payoutRatio: number;
  potentialProfitUsd: number;
  totalReturnIfWinUsd: number;
  entryPrice: number;
  settlementPrice: number | null;
  status: BinaryContractStatus;
  result: BinaryResult;
  openedAt: string;
  expiresAt: string;
  settledAt: string | null;
  marketDataSource: string | null;
  /** Who opened the contract: MANUAL_BINARY | AI_BINARY. */
  source: string;
  rejectionReason: string | null;
  notes: string | null;
  /* ---- live fields, computed by GET /api/binary/open (Phase 6.5.3) ---- */
  currentStatus?: 'WINNING' | 'LOSING' | 'FLAT';
  currentPrice?: number;
  timeRemainingMs?: number;
  /** Profit if the contract wins (= potentialProfitUsd). */
  potentialProfit?: number;
  /** Loss if the contract loses (= stakeUsd). */
  potentialLoss?: number;
  /** Only when BINARY_SHOW_ESTIMATED_UNREALIZED_PNL is on; otherwise null. */
  estimatedUnrealizedPnl?: number | null;
}

export interface BinaryQuote {
  stake: number;
  payoutRatio: number;
  potentialProfit: number;
  totalReturnIfWin: number;
  totalLossIfLose: number;
  currentPrice: number;
  warnings: string[];
}

export interface BinarySummary {
  wins: number;
  losses: number;
  refunds: number;
  netPnlUsd: number;
  openCount: number;
}

export interface BinaryConfig {
  enabled: boolean;
  liveTradingEnabled: boolean;
  allowedDurationsSeconds: number[];
  allowedPayoutRatios: number[];
  minStakeUsd: number;
  maxStakeUsd: number;
  defaultStakeUsd: number;
  maxOpenContracts: number;
  maxPriceStaleMs: number;
  settlementSource: string;
}

/* ------------------------------ AI binary trading -------------------------- */

export type AiBinaryMode = 'DISABLED' | 'SIGNAL_ONLY' | 'AUTO_EXECUTE';

export type AiBinarySignal = 'UP' | 'DOWN' | 'NEUTRAL';

/** One AI evaluation: stored for every evaluation, traded or not. */
export interface AiBinaryDecision {
  id: number;
  createdAt: string;
  asset: string;
  signal: AiBinarySignal;
  confidence: number;
  reason: string | null;
  featuresJson: string | null;
  mode: AiBinaryMode;
  autoExecuted: boolean;
  rejectionReason: string | null;
  binaryContractId: number | null;
  marketPrice: number;
  updatedAt: string;
}

export interface AiBinaryStats {
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  refunds: number;
  netPnl: number;
  consecutiveLosses: number;
  sessionLossUsd: number;
  sessionProfitUsd: number;
  dailyProfitUsd: number;
  profitTargetUsd: number;
  dailyProfitLimitPercent: number;
  remainingProfitUntilTarget: number;
  profitTargetReachedAt: string | null;
  stoppedByProfitTarget: boolean;
}

export interface AiBinaryStatus {
  enabled: boolean;
  mode: AiBinaryMode;
  running: boolean;
  currentSignal: AiBinarySignal | null;
  confidence: number;
  reason: string | null;
  stakeUsd: number;
  durationSeconds: number;
  payoutRatio: number;
  minConfidence: number;
  maxOpenContracts: number;
  maxSessionLossUsd: number;
  lastSignalAt: string | null;
  lastTradeAt: string | null;
  openContracts: number;
  sessionStats: AiBinaryStats;
  warnings: string[];
  profitTargetEnabled: boolean;
  profitTargetUsd: number;
  sessionProfitUsd: number;
  dailyProfitUsd: number;
  stoppedByProfitTarget: boolean;
}

export interface AiBinarySettingsUpdate {
  mode?: AiBinaryMode;
  stakeUsd?: number;
  durationSeconds?: number;
  payoutRatio?: number;
  minConfidence?: number;
  maxOpenContracts?: number;
  maxSessionLossUsd?: number;
  profitTargetEnabled?: boolean;
  profitTargetUsd?: number;
  dailyProfitLimitPercent?: number;
  stopOnProfitTarget?: boolean;
}

/** A single market price observation used for binary entry/settlement. */
export interface PriceTick {
  price: number;
  timestamp: string; // ISO
  source: string;
}

