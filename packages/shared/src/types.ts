/**
 * Shared domain types for the aioption monorepo.
 *
 * These interfaces describe the SQLite persistence layer (apps/server/src/db)
 * and are intentionally framework-free so both server and web can import them.
 */

/** Trading environment: PAPER = simulation, TESTNET = venue test network, LIVE = real funds. */
export type TradingMode = 'PAPER' | 'TESTNET' | 'LIVE';

/** Option contract side. */
export type OptionSide = 'CALL' | 'PUT';

/** Lifecycle state of a position. */
export type PositionStatus = 'OPEN' | 'CLOSED';

/** Kind of wallet movement. */
export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRADE_BUY'
  | 'TRADE_SELL'
  | 'PREMIUM_CREDIT'
  | 'FEE'
  | 'ADJUSTMENT';

/** Action recommended (and possibly executed) by the AI engine. */
export type AiAction = 'OPEN_CALL' | 'OPEN_PUT' | 'CLOSE' | 'HOLD' | 'NO_TRADE';

/** Kind of risk event recorded by the risk engine. */
export type RiskEventType =
  | 'LOSS_LIMIT_DAILY'
  | 'LOSS_LIMIT_WEEKLY'
  | 'MAX_OPEN_POSITIONS'
  | 'EQUITY_LOW';

/** Single-row account record (always id = 1): equity, balances, limits, settings. */
export interface Account {
  id: number;
  mode: TradingMode;
  /** Total account equity in USD. */
  equity: number;
  /** Uncommitted cash available for new trades. */
  cashBalance: number;
  /** Cash reserved by open positions. */
  lockedBalance: number;
  baseCurrency: string;
  fixedTradeSizeUsd: number;
  maxOpenPositions: number;
  /** Daily loss limit as a percentage of equity. */
  lossLimitPercent: number;
  createdAt: string;
  updatedAt: string;
}

/** An options trade, open or closed. */
export interface Position {
  id: number;
  /** Underlying asset symbol, e.g. BTC. */
  symbol: string;
  side: OptionSide;
  strikePrice: number;
  /** Expiry date (ISO date). */
  expiry: string;
  /** Number of contracts (can be fractional). */
  quantity: number;
  /** Premium paid/received per contract at entry, in USD. */
  entryPremium: number;
  /** Premium per contract at exit, in USD (null while OPEN). */
  exitPremium: number | null;
  status: PositionStatus;
  /** Realized P/L in USD (null while OPEN). */
  realizedPnl: number | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
}

/** A wallet movement (deposit, withdrawal, trade settlement, fee…). */
export interface Transaction {
  id: number;
  type: TransactionType;
  /** Signed amount in `currency`: deposits positive, withdrawals negative. */
  amount: number;
  currency: string;
  description: string | null;
  /** Position this transaction belongs to, if any. */
  positionId: number | null;
  createdAt: string;
}

/** A logged AI signal/decision. */
export interface AiDecision {
  id: number;
  symbol: string;
  action: AiAction;
  /** Model confidence in the decision, 0..1. */
  confidence: number;
  rationale: string | null;
  /** Whether the decision was acted upon (resulting in a trade). */
  executed: boolean;
  /** Position opened/closed as a result of this decision, if any. */
  positionId: number | null;
  createdAt: string;
}

/** A risk-engine trigger (e.g. loss limit hit). */
export interface RiskEvent {
  id: number;
  type: RiskEventType;
  message: string;
  /** Account equity at the moment the event fired, in USD. */
  equityAtTrigger: number;
  triggeredAt: string;
}

/* ------------------------- Repository input types ------------------------- */

export type AccountUpdate = Partial<
  Pick<
    Account,
    | 'mode'
    | 'equity'
    | 'cashBalance'
    | 'lockedBalance'
    | 'fixedTradeSizeUsd'
    | 'maxOpenPositions'
    | 'lossLimitPercent'
  >
>;

export type NewPosition = Omit<Position, 'id' | 'status' | 'exitPremium' | 'realizedPnl' | 'closedAt' | 'createdAt'>;

export type PositionUpdate = Partial<Pick<Position, 'status' | 'exitPremium' | 'realizedPnl' | 'closedAt'>>;

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt'>;

export type NewAiDecision = Omit<AiDecision, 'id' | 'createdAt' | 'executed' | 'positionId'> & {
  executed?: boolean;
  positionId?: number | null;
};

export type NewRiskEvent = Omit<RiskEvent, 'id' | 'triggeredAt'>;
