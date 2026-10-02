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
  | 'ADJUSTMENT'
  | 'BINARY_STAKE_LOCKED'
  | 'BINARY_WIN'
  | 'BINARY_LOSS'
  | 'BINARY_REFUND'
  | 'BINARY_FEE'
  | 'AI_BINARY_STAKE_LOCKED'
  | 'AI_BINARY_WIN'
  | 'AI_BINARY_LOSS'
  | 'AI_BINARY_REFUND'
  | 'OPTION_STAKE_LOCKED'
  | 'OPTION_SETTLE_WIN'
  | 'OPTION_SETTLE_LOSS'
  | 'OPTION_SETTLE_REFUND';

/** Action recommended (and possibly executed) by the AI engine. */
export type AiAction = 'OPEN_CALL' | 'OPEN_PUT' | 'CLOSE' | 'HOLD' | 'NO_TRADE';

/** Kind of risk event recorded by the risk engine. */
export type RiskEventType =
  | 'LOSS_LIMIT_DAILY'
  | 'LOSS_LIMIT_WEEKLY'
  | 'MAX_OPEN_POSITIONS'
  | 'EQUITY_LOW'
  | 'BINARY_CONTRACT_REJECTED'
  | 'BINARY_LOSS_LIMIT_BLOCK'
  | 'BINARY_MARKET_DATA_STALE'
  | 'BINARY_SETTLEMENT_ERROR'
  | 'BINARY_MAX_OPEN_CONTRACTS_REACHED'
  | 'AI_BINARY_SIGNAL_GENERATED'
  | 'AI_BINARY_TRADE_EXECUTED'
  | 'AI_BINARY_TRADE_REJECTED'
  | 'AI_BINARY_STOPPED_BY_USER'
  | 'AI_BINARY_STOPPED_BY_LOSS_LIMIT'
  | 'AI_BINARY_STOPPED_BY_DAILY_LOSS_LIMIT'
  | 'AI_BINARY_STOPPED_BY_CONSECUTIVE_LOSSES'
  | 'AI_BINARY_STOPPED_BY_SESSION_LOSS_LIMIT'
  | 'AI_BINARY_MARKET_DATA_STALE'
  | 'AI_BINARY_MAX_TRADES_PER_HOUR_REACHED'
  | 'AI_BINARY_STOPPED_BY_PROFIT_TARGET'
  | 'AI_BINARY_PROFIT_TARGET_REACHED'
  | 'AI_BINARY_DAILY_PROFIT_LIMIT_REACHED'
  | 'OPTION_EXPIRED_SETTLED'
  | 'OPTION_EXPIRED_REFUNDED'
  | 'OPTION_SETTLEMENT_PRICE_STALE'
  | 'MAX_STAKE_LIMIT_REJECTED'
  | 'DAILY_LOSS_LIMIT_40_PERCENT_TRIGGERED'
  | 'TRON_FEE_INSUFFICIENT_WITHDRAWAL_BLOCKED'
  | 'BINARY_SESSION_GAIN_LIMIT_REACHED'
  | 'BINARY_SESSION_GAIN_LIMIT_BLOCK'
  | 'BINARY_SESSION_RESET'
  | 'AI_BINARY_STOPPED_BY_SESSION_GAIN_LIMIT'
  | 'CLASSIC_LOCKED_BALANCE_REPAIRED'
  | 'CLASSIC_TOTAL_LOSS_LIMIT_BLOCK'
  | 'CLASSIC_EMERGENCY_REFUND';

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
  /** Maximum stake for a single classic option, in USD. */
  maxOptionStakeUsd: number;
  /** Default classic-option duration in seconds. */
  optionDefaultDurationSeconds: number;
  /** Binary session gain limit enabled flag. */
  binarySessionGainLimitEnabled: boolean;
  /** Binary max session gain in USDC. */
  binaryMaxSessionGainUsdc: number;
  /** Optional binary session gain limit as % of starting equity. */
  binaryMaxSessionGainPercent: number;
  /** Whether the trading loop is allowed to execute trades. */
  tradingEnabled: boolean;
  /** Equity snapshot taken when trading was enabled — the loss-limit baseline. */
  startingEquity: number;
  /** Whether the UI shows the post-trade keep/withdraw prompt (default true). */
  postTradePromptEnabled: boolean;
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
  /** Contract duration in seconds. */
  durationSeconds: number | null;
  /** Exact expiry timestamp (ISO). */
  expiresAt: string | null;
  /** Timestamp when settlement happened (ISO). */
  settledAt: string | null;
  /** Market price used for settlement. */
  settlementPrice: number | null;
  /** OPEN | SETTLING | SETTLED | REFUNDED | ERROR | CANCELLED. */
  settlementStatus: string | null;
  /** Human-readable settlement explanation. */
  settlementReason: string | null;
  /** Who opened the position: MANUAL | AI. */
  source: string;
  /* ---- computed by the API (not stored) ---- */
  /** Total stake locked (entry premium × quantity), in USD. */
  stakeUsd?: number;
  /** Seconds until expiry (0 when expired/settled). */
  secondsRemaining?: number;
  /** Latest market price of the underlying. */
  currentPrice?: number;
  /** Mark-to-market PnL of an open position, in USD. */
  unrealizedPnl?: number;
  /** Potential profit if the option wins, in USD. */
  potentialProfitUsd?: number;
  /** Potential loss (the stake) if the option loses, in USD. */
  potentialLossUsd?: number;
  /** Option type stored for classic options (Phase 6.5.1): CLASSIC | LEGACY. */
  optionType?: string;
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

/** Market outlook produced by the signal engine. */
export type MarketSignal = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

/** A logged AI signal/decision. */
export interface AiDecision {
  id: number;
  symbol: string;
  /** Market outlook from the signal engine. */
  signal: MarketSignal;
  /** Suggested trade action derived from the signal. */
  action: AiAction;
  /** Model confidence in the decision, 0..1. */
  confidence: number;
  /** Expected return over the signal horizon (fraction, e.g. 0.03 = 3%). */
  expectedReturn: number;
  /** Proposed trade size in USD, strictly the configured fixed size. */
  proposedTradeSizeUsd: number;
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

/** Dashboard summary: account state + PnL aggregates + loop status. */
export interface AccountSummary {
  account: Account;
  /** Sum of realized PnL across CLOSED positions, in USD. */
  realizedPnl: number;
  /** Realized PnL from settled binary contracts, in USD. */
  binaryNetPnl: number;
  /** Mark-to-market PnL of OPEN positions (0 while no pricing model exists). */
  unrealizedPnl: number;
  /** Whether the trading loop scheduler is currently running. */
  loopRunning: boolean;
  /** Daily loss limit as configured (%). */
  dailyLossLimitPercent: number;
  /** USD headroom between current equity and the loss floor. */
  dailyLossRemainingUsd: number;
  /** Equity level at which the daily loss limit triggers. */
  lossLimitFloorUsd: number;
  /** Combined binary session net gain (manual + AI), in USD. */
  binarySessionGainUsd: number;
  /** Configured binary session gain limit in USDC (0 = disabled). */
  binarySessionGainLimitUsd: number;
  /** USD remaining until the binary session gain limit. */
  binarySessionGainRemainingUsd: number;
  /** Whether the binary session gain limit has been reached. */
  binarySessionGainLimitReached: boolean;
  /** Latest AI binary session profit, in USD. */
  aiBinarySessionProfitUsd: number;
}

/* ------------------------------ Tron transfers ---------------------------- */

/** Tron network mode. */
export type TronMode = 'SIMULATED' | 'SHASTA' | 'NILE' | 'MAINNET';

export type DepositStatus =
  | 'DETECTED'
  | 'CONFIRMING'
  | 'PENDING'
  | 'CONFIRMED'
  | 'CREDITED'
  | 'IGNORED'
  | 'FAILED';

export type WithdrawalStatus =
  | 'REQUESTED'
  | 'PENDING_FEE'
  | 'APPROVED'
  | 'BROADCAST'
  | 'CONFIRMED'
  | 'FAILED'
  | 'DISABLED'
  | 'SIMULATED';

/** A USDC (TRC20) deposit credited to the wallet. */
export interface Deposit {
  id: number;
  network: string;
  asset: string;
  tokenStandard: string;
  amount: number;
  fromAddress: string | null;
  txid: string | null;
  status: DepositStatus;
  confirmations: number;
  createdAt: string;
  creditedAt: string | null;
  notes: string | null;
}

/** A USDC (TRC20) withdrawal from the wallet. */
export interface Withdrawal {
  id: number;
  network: string;
  asset: string;
  tokenStandard: string;
  amount: number;
  destinationAddress: string;
  status: WithdrawalStatus;
  txid: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  feeEstimateTrx: number | null;
  feeEstimateUsd: number | null;
  feePayer: string | null;
  feeStatus: string | null;
  feeNotes: string | null;
}

/** Static deposit information for the UI. */
export interface DepositInfo {
  address: string;
  /** Where the address comes from (Phase 6.5.1): DATABASE | ENVIRONMENT | SIMULATED | NOT_SET. */
  addressSource?: AddressSource;
  network: 'TRON';
  asset: 'USDC';
  tokenStandard: 'TRC20';
  tronMode: TronMode;
  liveWithdrawalsEnabled: boolean;
  requiredConfirmations: number;
  lastSyncedAt: string | null;
}

/* ------------------------------- SSE events ------------------------------- */

export type ApiEventType =
  | 'account'
  | 'decision'
  | 'trade'
  | 'risk'
  | 'deposit'
  | 'withdrawal'
  | 'binary'
  | 'ai-binary'
  | 'tron'
  | 'wallet'
  | 'options'
  | 'classic'
  | 'settings';

/** Server-sent event pushed to the frontend. */
export interface ApiEvent {
  type: ApiEventType;
  payload: unknown;
  timestamp: string;
}

/** Repository input types */

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
    | 'maxOptionStakeUsd'
    | 'optionDefaultDurationSeconds'
    | 'binarySessionGainLimitEnabled'
    | 'binaryMaxSessionGainUsdc'
    | 'binaryMaxSessionGainPercent'
    | 'tradingEnabled'
    | 'startingEquity'
    | 'postTradePromptEnabled'
  >
>;

export type NewPosition = Omit<
  Position,
  | 'id'
  | 'status'
  | 'exitPremium'
  | 'realizedPnl'
  | 'closedAt'
  | 'createdAt'
  | 'durationSeconds'
  | 'expiresAt'
  | 'settledAt'
  | 'settlementPrice'
  | 'settlementStatus'
  | 'settlementReason'
  | 'source'
> & {
  durationSeconds?: number | null;
  expiresAt?: string | null;
  source?: string;
  /** Exact stake locked for this position (Phase 6.5.1). */
  stakeUsd?: number;
  optionType?: string;
};

export type PositionUpdate = Partial<
  Pick<
    Position,
    | 'status'
    | 'exitPremium'
    | 'realizedPnl'
    | 'closedAt'
    | 'settledAt'
    | 'settlementPrice'
    | 'settlementStatus'
    | 'settlementReason'
  >
>;

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt'>;

export type NewAiDecision = Omit<AiDecision, 'id' | 'createdAt' | 'executed' | 'positionId'> & {
  executed?: boolean;
  positionId?: number | null;
};

export type NewRiskEvent = Omit<RiskEvent, 'id' | 'triggeredAt'>;

/* ---------------------------- Phase 6.4 types ------------------------------ */

/** Classic-option limits and allowed durations. */
export interface OptionConfig {
  minStakeUsd: number;
  maxStakeUsd: number;
  defaultStakeUsd: number;
  allowedDurationsSeconds: number[];
  defaultDurationSeconds: number;
  maxDurationSeconds: number;
}

export type TronConnectionStatus = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'NOT_CONFIGURED';
export type TronReadiness = 'READY_TO_TRADE' | 'TRADE_BLOCKED' | 'WITHDRAWAL_BLOCKED' | 'FEE_RESOURCE_LOW' | 'CONFIGURATION_MISSING';

/** Tron network status for the UI indicator + modal. */
export interface TronStatus {
  mode: TronMode;
  networkName: string;
  connectionStatus: TronConnectionStatus;
  readyToTrade: boolean;
  readiness: TronReadiness;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  liveWithdrawalsEnabled: boolean;
  depositAddress: string;
  /** Where depositAddress comes from (Phase 6.5.1). */
  depositAddressSource?: AddressSource;
  hotWalletAddress: string;
  usdcContractAddress: string;
  requiredConfirmations: number;
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  lowFeeResource: boolean;
  lastCheckedAt: string | null;
  warnings: string[];
}

/** Estimated network fee for a Tron USDC (TRC20) withdrawal. */
export interface TronFeeEstimate {
  network: 'TRON';
  asset: 'USDC';
  tokenStandard: 'TRC20';
  estimatedFeeTrx: number;
  estimatedFeeUsd: number;
  feePayer: 'HOT_WALLET' | 'DEDUCT_FROM_WITHDRAWAL';
  energyRequired: number;
  bandwidthRequired: number;
  hotWalletTrxBalance: number;
  hotWalletEnergyAvailable: number;
  sufficientFeeResources: boolean;
  warnings: string[];
}

export type WalletRecordKind = 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'FEE' | 'REFUND' | 'FEE_DEPOSIT';

/** Unified wallet record for the Wallet Records page. */
export interface WalletRecord {
  id: string;
  kind: WalletRecordKind;
  time: string;
  type: string;
  amount: number;
  asset: string;
  network: string | null;
  status: string;
  reference: string | null;
  txid: string | null;
  destinationAddress: string | null;
  depositAddress: string | null;
  feeEstimateTrx: number | null;
  feeEstimateUsd: number | null;
  feePaidBy: string | null;
  notes: string | null;
  explorerUrl: string | null;
}

export interface WalletRecordsSummary {
  availableBalance: number;
  lockedBalance: number;
  totalEquity: number;
  pendingWithdrawals: number;
  pendingDeposits: number;
  hotWalletTrxBalance: number;
  feeResourcesSufficient: boolean;
}

/* ----------------------------- Phase 6.5 types ------------------------------ */

/** Binary options session gain-limit stats (manual + AI combined). */
export interface BinarySessionStats {
  sessionStartedAt: string;
  manualNetGain: number;
  aiNetGain: number;
  combinedNetGain: number;
  wins: number;
  losses: number;
  refunds: number;
  gainLimitEnabled: boolean;
  maxSessionGainUsdc: number;
  maxSessionGainPercent: number;
  remainingSessionGain: number;
  gainLimitReached: boolean;
  gainLimitReason: string | null;
}

export interface BinarySessionSettingsUpdate {
  gainLimitEnabled?: boolean;
  maxSessionGainUsdc?: number;
  maxSessionGainPercent?: number;
}

/** TRX fee-wallet deposit info for the UI. */
export interface TrxFeeDepositInfo {
  feeWalletAddress: string;
  sameAddressAsDeposit: boolean;
  asset: 'TRX';
  network: 'TRON';
  purpose: string;
  acceptTrxDeposits: boolean;
  requiredConfirmations: number;
  warning: string;
}

export interface TrxFeeStatus {
  feeWalletAddress: string;
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  minTrxFeeReserve: number;
  sufficientFeeReserve: boolean;
  estimatedWithdrawalsSupported: number;
  lastCheckedAt: string | null;
  warnings: string[];
}

export interface TrxFeeDeposit {
  id: number;
  network: string;
  asset: string;
  amountTrx: number;
  fromAddress: string | null;
  txid: string | null;
  status: 'DETECTED' | 'CONFIRMING' | 'CONFIRMED' | 'CREDITED' | 'FAILED';
  confirmations: number;
  createdAt: string;
  creditedAt: string | null;
  notes: string | null;
}


/* --------------------------- Phase 6.5.1 types ----------------------------- */

/** Why new classic options are currently blocked (null = not blocked). */
export type ClassicBlockedReason =
  | 'TRADING_DISABLED'
  | 'LOSS_LIMIT_REACHED'
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'MARKET_DATA_STALE'
  | 'RISK_ENGINE_BLOCKED';

/** Classic Options settings (GET/PUT /api/classic/settings). */
export interface ClassicSettings {
  tradingEnabled: boolean;
  defaultStakeUsd: number;
  maxStakeUsd: number;
  minStakeUsd: number;
  /** Hard ceiling for maxStakeUsd (configuration). */
  maxStakeCeilingUsd: number;
  defaultDurationSeconds: number;
  allowedDurationsSeconds: number[];
  maxDurationSeconds: number;
  dailyLossLimitPercent: number;
  /** 0 = total loss limit disabled. */
  totalLossLimitPercent: number;
  currentLockedBalance: number;
  availableBalance: number;
  openPositionCount: number;
}

export type ClassicSettingsUpdate = Partial<
  Pick<
    ClassicSettings,
    | 'defaultStakeUsd'
    | 'maxStakeUsd'
    | 'defaultDurationSeconds'
    | 'dailyLossLimitPercent'
    | 'totalLossLimitPercent'
  >
>;

/** Classic Options live status (GET /api/classic/status). */
export interface ClassicStatus {
  tradingEnabled: boolean;
  loopRunning: boolean;
  blockedReason: ClassicBlockedReason | null;
  blockedMessage: string | null;
  openPositions: number;
  lockedBalance: number;
  /** Sum of the stakes of all open classic positions. */
  openClassicStakeUsd: number;
  availableBalance: number;
  marketDataFresh: boolean;
  lastUpdated: string;
}

export type AddressSource = 'DATABASE' | 'ENVIRONMENT' | 'SIMULATED' | 'NOT_SET';

export interface AddressValidation {
  valid: boolean;
  addressType: 'TRON' | 'UNKNOWN';
  reason?: string;
}

/** User-editable Tron addresses (GET /api/wallet/addresses). */
export interface WalletAddresses {
  usdcTradeAddress: string;
  withdrawalDestinationAddress: string;
  /** Effective withdrawal destination (falls back to usdcTradeAddress). */
  effectiveWithdrawalDestinationAddress: string;
  trxFeeWalletAddress: string;
  usdcTradeAddressSource: AddressSource;
  withdrawalDestinationAddressSource: AddressSource;
  trxFeeWalletAddressSource: AddressSource;
  updatedAt: string | null;
  validationStatus: {
    usdcTradeAddress: AddressValidation;
    withdrawalDestinationAddress: AddressValidation | null;
    trxFeeWalletAddress: AddressValidation;
  };
}

/** One row of the settings audit log (GET /api/settings/audit). */
export interface SettingsAuditEntry {
  id: number;
  key: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

export interface WalletAddressesUpdate {
  usdcTradeAddress?: string;
  /** Empty string clears the override (falls back to usdcTradeAddress). */
  withdrawalDestinationAddress?: string;
  /** Empty string clears the override (falls back to env/simulated). */
  trxFeeWalletAddress?: string;
}

