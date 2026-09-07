export type Asset = 'USDC' | 'USD' | 'ETH' | 'BTC';
export type WalletType = 'PAPER' | 'METAMASK' | 'SMART_WALLET';
export type Chain = 'ETHEREUM' | 'POLYGON' | 'ARBITRUM' | 'PAPER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type KycStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type Direction = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type OptionType = 'CALL' | 'PUT';
export type StrikeType = 'ATM' | 'OTM' | 'ITM';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus =
  | 'PENDING'
  | 'RISK_APPROVED'
  | 'RISK_REJECTED'
  | 'SUBMITTED'
  | 'FILLED'
  | 'CANCELED'
  | 'FAILED';
export type PositionStatus = 'OPEN' | 'CLOSED' | 'EXPIRED' | 'CANCELED';
export type WithdrawalStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';
export type LedgerEventType =
  | 'DEPOSIT'
  | 'WITHDRAWAL_REQUEST'
  | 'WITHDRAWAL_COMPLETE'
  | 'OPTION_PREMIUM_PAID'
  | 'OPTION_PREMIUM_RECEIVED'
  | 'TRADING_FEE'
  | 'PLATFORM_FEE'
  | 'OPTION_SETTLEMENT_PROFIT'
  | 'OPTION_SETTLEMENT_LOSS'
  | 'ADJUSTMENT';
export type DepositStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  jurisdiction: string;
  riskAcknowledgedAt: Date | null;
  kycStatus: KycStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Wallet {
  id: string;
  userId: string;
  walletType: WalletType;
  walletAddress: string | null;
  chain: Chain;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerAccount {
  id: string;
  userId: string;
  walletId: string;
  asset: Asset;
  accountType: 'BALANCE' | 'LOCKED' | 'PENDING';
  createdAt: Date;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  accountId: string;
  asset: Asset;
  debit: string;
  credit: string;
  eventType: LedgerEventType;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface TradingSettings {
  id: string;
  userId: string;
  autoTradingEnabled: boolean;
  maxTradeSizeUsd: string;
  dailyLossLimitUsd: string;
  weeklyLossLimitUsd: string;
  maxOpenPositions: number;
  reinvestProfits: boolean;
  allowedAssets: Asset[];
  allowedOptionTypes: OptionType[];
  minAiConfidence: number;
  maxSlippagePercent: number;
  maxSpreadPercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  continuousTrading: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiSignal {
  id: string;
  userId: string;
  asset: Asset;
  direction: Direction;
  confidence: number;
  expectedReturn: number;
  riskScore: number;
  strategy: string;
  optionType: OptionType;
  expiryDays: number;
  strikeType: StrikeType;
  maxPremiumUsd: string;
  reason: string[];
  executed: boolean;
  createdAt: Date;
}

export interface RiskEvent {
  id: string;
  userId: string;
  signalId: string;
  checkName: string;
  passed: boolean;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Order {
  id: string;
  userId: string;
  signalId: string | null;
  venue: string;
  asset: Asset;
  optionType: OptionType;
  side: OrderSide;
  strikeType: StrikeType;
  expiryDays: number;
  premiumLimitUsd: string;
  actualPremiumUsd: string | null;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Position {
  id: string;
  userId: string;
  orderId: string;
  asset: Asset;
  optionType: OptionType;
  status: PositionStatus;
  entryPremiumUsd: string;
  currentValueUsd: string;
  unrealizedPnlUsd: string;
  realizedPnlUsd: string;
  expiresAt: Date;
  openedAt: Date;
  closedAt: Date | null;
}

export interface Deposit {
  id: string;
  userId: string;
  walletId: string;
  asset: Asset;
  amount: string;
  status: DepositStatus;
  createdAt: Date;
}

export interface Withdrawal {
  id: string;
  userId: string;
  walletId: string;
  asset: Asset;
  amount: string;
  destinationAddress: string;
  status: WithdrawalStatus;
  approvedBy: string | null;
  rejectedBy: string | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketSnapshot {
  id: string;
  asset: Asset;
  spotPrice: string;
  volatility: string;
  timestamp: Date;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string;
  createdAt: Date;
}

export interface OptionQuoteRequest {
  asset: Asset;
  optionType: OptionType;
  strikeType: StrikeType;
  expiryDays: number;
  currentSpot: string;
  volatility: string;
}

export interface OptionQuote {
  asset: Asset;
  optionType: OptionType;
  strikeType: StrikeType;
  expiryDays: number;
  strikePrice: string;
  premiumUsd: string;
  bidUsd: string;
  askUsd: string;
  spreadPercent: string;
  slippageEstimate: string;
  timestamp: Date;
  venue: string;
}

export interface OptionOrderRequest {
  userId: string;
  asset: Asset;
  optionType: OptionType;
  side: OrderSide;
  strikeType: StrikeType;
  expiryDays: number;
  maxPremiumUsd: string;
  quantity: number;
}

export interface OptionOrderResult {
  orderId: string;
  status: 'FILLED' | 'REJECTED' | 'PARTIAL';
  filledPremiumUsd: string;
  filledQuantity: number;
  positionId: string;
  venue: string;
  timestamp: Date;
}

export interface OptionPosition {
  positionId: string;
  userId: string;
  asset: Asset;
  optionType: OptionType;
  entryPremiumUsd: string;
  currentValueUsd: string;
  unrealizedPnlUsd: string;
  expiresAt: Date;
  openedAt: Date;
}

export interface OptionCloseResult {
  positionId: string;
  closeValueUsd: string;
  realizedPnlUsd: string;
  status: 'CLOSED' | 'EXPIRED';
  timestamp: Date;
}