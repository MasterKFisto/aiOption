import type {
  ClassicDirectionState,
  ClassicStrategySettings,
  ClassicStrategySettingsUpdate,
  AddressValidation,
  ClassicSettings,
  ClassicSettingsUpdate,
  ClassicStatus,
  WalletAddresses,
  WalletAddressesUpdate,
  AccountSummary,
  AiBinaryDecision,
  AiBinarySettingsUpdate,
  AiBinaryStatus,
  AiDecision,
  BinaryConfig,
  BinaryContract,
  BinaryQuote,
  BinarySessionSettingsUpdate,
  BinarySessionStats,
  BinarySummary,
  Candle,
  Deposit,
  DepositInfo,
  LiveTicker,
  OptionConfig,
  Position,
  PriceTick,
  RiskEvent,
  TronFeeEstimate,
  TronStatus,
  TrxFeeDeposit,
  TrxFeeDepositInfo,
  TrxFeeStatus,
  WalletRecord,
  WalletRecordsSummary,
  Withdrawal,
} from '@aioption/shared';

export interface ClassicStrategyResponse {
  settings: ClassicStrategySettings;
  direction: ClassicDirectionState;
}

export interface RiskSettingsUpdate {
  maxOpenPositions?: number;
  lossLimitPercent?: number;
  fixedTradeSizeUsd?: number;
  postTradePromptEnabled?: boolean;
  maxOptionStakeUsd?: number;
  optionDefaultDurationSeconds?: number;
}

export interface RiskSettingsResult {
  maxOpenPositions: number;
  lossLimitPercent: number;
  fixedTradeSizeUsd: number;
  postTradePromptEnabled: boolean;
  maxOptionStakeUsd: number;
  optionDefaultDurationSeconds: number;
}

export interface TickerResponse {
  status: string;
  ticker: LiveTicker | null;
}

export interface CandlesResponse {
  symbol: string;
  interval: string;
  source: string;
  candles: Candle[];
}

export interface WithdrawalResult {
  withdrawal: Withdrawal;
  account?: AccountSummary['account'];
  message?: string;
  error?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  summary: () => request<AccountSummary>('/api/account/summary'),
  account: () => request<AccountSummary>('/api/account'),
  ticker: () => request<TickerResponse>('/api/market/ticker'),
  candles: (interval: '1m' | '5m' | '1h', limit = 300) =>
    request<CandlesResponse>(`/api/market/candles?interval=${interval}&limit=${limit}`),
  positions: (status?: 'OPEN' | 'CLOSED') =>
    request<Position[]>(`/api/positions${status ? `?status=${status}` : ''}`),
  decisions: (limit = 50) => request<AiDecision[]>(`/api/ai/decisions?limit=${limit}`),
  riskEvents: (limit = 50) => request<RiskEvent[]>(`/api/risk-events?limit=${limit}`),
  depositsInfo: () => request<DepositInfo>('/api/deposits/info'),
  deposits: () => request<Deposit[]>('/api/deposits'),
  simulateDeposit: (amount: number) =>
    request<{ deposit: Deposit | null; account: AccountSummary['account'] }>(
      '/api/deposits/simulate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      },
    ),
  withdrawals: () => request<Withdrawal[]>('/api/withdrawals'),
  createWithdrawal: (input: {
    amount: number;
    destinationAddress: string;
    confirmed: boolean;
  }) =>
    request<WithdrawalResult>('/api/withdrawals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateRiskSettings: (patch: RiskSettingsUpdate) =>
    request<RiskSettingsResult>('/api/trading/risk/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  startTrading: () =>
    request<{ running: boolean; startingEquity: number }>('/api/trading/start', {
      method: 'POST',
    }),
  stopTrading: () => request<{ running: boolean }>('/api/trading/stop', { method: 'POST' }),
  serverTime: () => request<{ serverTime: string; epochMs: number }>('/api/server-time'),
  binaryConfig: () => request<BinaryConfig>('/api/binary/config'),
  binaryQuote: (stake: number, duration: number, payoutRatio: number) =>
    request<BinaryQuote>(
      `/api/binary/quote?stake=${stake}&duration=${duration}&payoutRatio=${payoutRatio}`,
    ),
  openBinary: (input: {
    asset: string;
    direction: 'UP' | 'DOWN';
    stakeUsd: number;
    durationSeconds: number;
    payoutRatio: number;
  }) =>
    request<BinaryContract>('/api/binary/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  binaryOpen: () => request<BinaryContract[]>('/api/binary/open'),
  binaryHistory: (limit = 50) => request<BinaryContract[]>(`/api/binary/history?limit=${limit}`),
  binarySummary: () => request<BinarySummary>('/api/binary/summary'),
  ticks: (limit = 120) =>
    request<{ symbol: string; ticks: PriceTick[] }>(`/api/market/ticks?limit=${limit}`),
  aiBinaryStatus: () => request<AiBinaryStatus>('/api/binary-ai/status'),
  aiBinarySettings: (patch: AiBinarySettingsUpdate) =>
    request<AiBinaryStatus>('/api/binary-ai/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  aiBinaryStart: () => request<AiBinaryStatus>('/api/binary-ai/start', { method: 'POST' }),
  aiBinaryStop: () => request<AiBinaryStatus>('/api/binary-ai/stop', { method: 'POST' }),
  aiBinaryDecisions: (limit = 50) =>
    request<AiBinaryDecision[]>(`/api/binary-ai/decisions?limit=${limit}`),
  optionsConfig: () => request<OptionConfig>('/api/options/config'),
  openOption: (input: {
    asset: string;
    side: 'CALL' | 'PUT';
    stakeUsd: number;
    durationSeconds: number;
  }) =>
    request<Position>('/api/options/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  tronStatus: () => request<TronStatus>('/api/tron/status'),
  tronHealth: () => request<{ healthy: boolean; status: TronStatus }>('/api/tron/health'),
  tronFeeEstimate: (amount: number, destination: string) =>
    request<TronFeeEstimate>(
      `/api/tron/fee-estimate?amount=${amount}&destination=${encodeURIComponent(destination)}`,
    ),
  walletRecords: (type = 'ALL', limit = 100, offset = 0) =>
    request<{ records: WalletRecord[]; summary: WalletRecordsSummary }>(
      `/api/wallet/records?type=${type}&limit=${limit}&offset=${offset}`,
    ),
  walletRecord: (id: string) => request<WalletRecord>(`/api/wallet/records/${id}`),
  binarySessionStats: () => request<BinarySessionStats>('/api/binary/session-stats'),
  binarySessionSettings: (patch: BinarySessionSettingsUpdate) =>
    request<BinarySessionStats>('/api/binary/session-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  binarySessionReset: () =>
    request<BinarySessionStats>('/api/binary/session-reset', { method: 'POST' }),
  tronFeeDepositInfo: () => request<TrxFeeDepositInfo>('/api/tron/fee-deposit-info'),
  tronFeeStatus: () => request<TrxFeeStatus>('/api/tron/fee-status'),
  tronFeeDeposits: () => request<TrxFeeDeposit[]>('/api/tron/fee-deposits'),
  simulateTrxDeposit: (amountTrx: number) =>
    request<TrxFeeStatus>('/api/tron/simulate-trx-deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountTrx }),
    }),
  /* ----------------------------- Phase 6.5.3 ----------------------------- */
  binaryUnrealizedMode: () =>
    request<{ mode: 'CONSERVATIVE' | 'ESTIMATED' }>('/api/settings/binary-unrealized'),
  setBinaryUnrealizedMode: (showEstimated: boolean) =>
    request<{ mode: 'CONSERVATIVE' | 'ESTIMATED' }>('/api/settings/binary-unrealized', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showEstimated }),
    }),
  /* ----------------------------- Phase 6.5.2 ----------------------------- */
  classicStrategy: () => request<ClassicStrategyResponse>('/api/classic/strategy'),
  updateClassicStrategy: (patch: ClassicStrategySettingsUpdate) =>
    request<ClassicStrategyResponse>('/api/classic/strategy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  /* ----------------------------- Phase 6.5.1 ----------------------------- */
  classicSettings: () => request<ClassicSettings>('/api/classic/settings'),
  updateClassicSettings: (patch: ClassicSettingsUpdate) =>
    request<ClassicSettings>('/api/classic/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  classicStatus: () => request<ClassicStatus>('/api/classic/status'),
  classicStart: () => request<ClassicStatus>('/api/classic/trading/start', { method: 'POST' }),
  classicStop: () => request<ClassicStatus>('/api/classic/trading/stop', { method: 'POST' }),
  classicHistory: (limit = 20) => request<Position[]>(`/api/classic/history?limit=${limit}`),
  walletAddresses: () => request<WalletAddresses>('/api/wallet/addresses'),
  updateWalletAddresses: (patch: WalletAddressesUpdate) =>
    request<WalletAddresses>('/api/wallet/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  validateAddress: (address: string) =>
    request<AddressValidation>('/api/wallet/addresses/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    }),
};
