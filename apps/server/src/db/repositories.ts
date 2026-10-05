import type {
  Account,
  AccountUpdate,
  AiDecision,
  AiDecisionFeatures,
  Deposit,
  DepositStatus,
  NewAiDecision,
  NewPosition,
  NewRiskEvent,
  NewTransaction,
  Position,
  PositionStatus,
  PositionUpdate,
  RiskEvent,
  SettingsAuditEntry,
  Transaction,
  TrxFeeDeposit,
  WalletRecord,
  Withdrawal,
  WithdrawalStatus,
} from '@aioption/shared';

import { explorerTxUrl } from '../services/tronNetwork.js';
import { getDb } from './connection.js';

const now = (): string => new Date().toISOString();

/* ------------------------- row shapes (snake_case) ------------------------- */

interface AccountRow {
  id: number;
  mode: string;
  equity: number;
  cash_balance: number;
  locked_balance: number;
  base_currency: string;
  fixed_trade_size_usd: number;
  max_open_positions: number;
  loss_limit_percent: number;
  max_option_stake_usd: number;
  option_default_duration_seconds: number;
  binary_session_gain_limit_enabled: number;
  binary_max_session_gain_usdt: number;
  binary_max_session_gain_percent: number;
  trading_enabled: number;
  starting_equity: number;
  post_trade_prompt_enabled: number;
  created_at: string;
  updated_at: string;
}

interface PositionRow {
  id: number;
  symbol: string;
  side: string;
  strike_price: number;
  expiry: string;
  quantity: number;
  entry_premium: number;
  exit_premium: number | null;
  status: string;
  realized_pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  duration_seconds: number | null;
  expires_at: string | null;
  settled_at: string | null;
  settlement_price: number | null;
  settlement_status: string | null;
  settlement_reason: string | null;
  source: string;
  stake_usd: number | null;
  option_type: string | null;
}

interface TransactionRow {
  id: number;
  type: string;
  amount: number;
  currency: string;
  description: string | null;
  position_id: number | null;
  created_at: string;
}

interface AiDecisionRow {
  id: number;
  symbol: string;
  signal: string;
  action: string;
  confidence: number;
  expected_return: number;
  proposed_trade_size_usd: number;
  rationale: string | null;
  executed: number;
  position_id: number | null;
  created_at: string;
  features_json: string | null;
}

interface RiskEventRow {
  id: number;
  type: string;
  message: string;
  equity_at_trigger: number;
  triggered_at: string;
}

/* ------------------------------ row mappers ------------------------------ */

// The string-valued columns are constrained by CHECK/seed values in the
// schema; the casts below trust those invariants.

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  mode: r.mode as Account['mode'],
  equity: r.equity,
  cashBalance: r.cash_balance,
  lockedBalance: r.locked_balance,
  baseCurrency: r.base_currency,
  fixedTradeSizeUsd: r.fixed_trade_size_usd,
  maxOpenPositions: r.max_open_positions,
  lossLimitPercent: r.loss_limit_percent,
  maxOptionStakeUsd: r.max_option_stake_usd,
  optionDefaultDurationSeconds: r.option_default_duration_seconds,
  binarySessionGainLimitEnabled: r.binary_session_gain_limit_enabled === 1,
  binaryMaxSessionGainUsdt: r.binary_max_session_gain_usdt,
  binaryMaxSessionGainPercent: r.binary_max_session_gain_percent,
  tradingEnabled: r.trading_enabled === 1,
  startingEquity: r.starting_equity,
  postTradePromptEnabled: r.post_trade_prompt_enabled === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toPosition = (r: PositionRow): Position => ({
  id: r.id,
  symbol: r.symbol,
  side: r.side as Position['side'],
  strikePrice: r.strike_price,
  expiry: r.expiry,
  quantity: r.quantity,
  entryPremium: r.entry_premium,
  exitPremium: r.exit_premium,
  status: r.status as Position['status'],
  realizedPnl: r.realized_pnl,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
  createdAt: r.created_at,
  durationSeconds: r.duration_seconds,
  expiresAt: r.expires_at,
  settledAt: r.settled_at,
  settlementPrice: r.settlement_price,
  settlementStatus: r.settlement_status,
  settlementReason: r.settlement_reason,
  source: r.source,
  // Exact locked stake (Phase 6.5.1); legacy rows fall back to premium × qty.
  stakeUsd: r.stake_usd ?? Math.round(r.entry_premium * r.quantity * 100) / 100,
  optionType: r.option_type ?? 'CLASSIC',
});

/** The exact stake locked by a position (never recomputed with fees). */
export function positionStake(position: Pick<Position, 'stakeUsd' | 'entryPremium' | 'quantity'>): number {
  return position.stakeUsd ?? Math.round(position.entryPremium * position.quantity * 100) / 100;
}

const toTransaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  type: r.type as Transaction['type'],
  amount: r.amount,
  currency: r.currency,
  description: r.description,
  positionId: r.position_id,
  createdAt: r.created_at,
});

const toAiDecision = (r: AiDecisionRow): AiDecision => ({
  id: r.id,
  symbol: r.symbol,
  signal: r.signal as AiDecision['signal'],
  action: r.action as AiDecision['action'],
  confidence: r.confidence,
  expectedReturn: r.expected_return,
  proposedTradeSizeUsd: r.proposed_trade_size_usd,
  rationale: r.rationale,
  executed: r.executed === 1,
  positionId: r.position_id,
  createdAt: r.created_at,
  features: parseFeatures(r.features_json),
});

/** Parses a stored features JSON blob; malformed data never breaks a listing. */
function parseFeatures(raw: string | null): AiDecisionFeatures | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as AiDecisionFeatures) : null;
  } catch {
    return null;
  }
}

const toRiskEvent = (r: RiskEventRow): RiskEvent => ({
  id: r.id,
  type: r.type as RiskEvent['type'],
  message: r.message,
  equityAtTrigger: r.equity_at_trigger,
  triggeredAt: r.triggered_at,
});

/* --------------------------------- account -------------------------------- */

// better-sqlite3 requires every named parameter to be present in the bind
// object; bind unset fields as NULL and let COALESCE keep the stored values.
type AccountBind = {
  mode: Account['mode'] | null;
  equity: number | null;
  cashBalance: number | null;
  lockedBalance: number | null;
  fixedTradeSizeUsd: number | null;
  maxOpenPositions: number | null;
  lossLimitPercent: number | null;
  maxOptionStakeUsd: number | null;
  optionDefaultDurationSeconds: number | null;
  binarySessionGainLimitEnabled: number | null;
  binaryMaxSessionGainUsdt: number | null;
  binaryMaxSessionGainPercent: number | null;
  tradingEnabled: number | null;
  startingEquity: number | null;
  postTradePromptEnabled: number | null;
  updatedAt: string;
};

/** Reads the single account row (id = 1). */
export function getAccount(): Account {
  const row = getDb().prepare<[], AccountRow>('SELECT * FROM account WHERE id = 1').get();
  if (!row) {
    throw new Error('Account row missing — did the migrations run?');
  }
  return toAccount(row);
}

/** Updates the provided account fields (COALESCE keeps unset fields). */
export function updateAccount(patch: AccountUpdate): Account {
  getDb()
    .prepare<AccountBind, unknown>(
      `UPDATE account SET
         mode = COALESCE(@mode, mode),
         equity = COALESCE(@equity, equity),
         cash_balance = COALESCE(@cashBalance, cash_balance),
         locked_balance = COALESCE(@lockedBalance, locked_balance),
         fixed_trade_size_usd = COALESCE(@fixedTradeSizeUsd, fixed_trade_size_usd),
         max_open_positions = COALESCE(@maxOpenPositions, max_open_positions),
         loss_limit_percent = COALESCE(@lossLimitPercent, loss_limit_percent),
         max_option_stake_usd = COALESCE(@maxOptionStakeUsd, max_option_stake_usd),
         option_default_duration_seconds = COALESCE(@optionDefaultDurationSeconds, option_default_duration_seconds),
         binary_session_gain_limit_enabled = COALESCE(@binarySessionGainLimitEnabled, binary_session_gain_limit_enabled),
         binary_max_session_gain_usdt = COALESCE(@binaryMaxSessionGainUsdt, binary_max_session_gain_usdt),
         binary_max_session_gain_percent = COALESCE(@binaryMaxSessionGainPercent, binary_max_session_gain_percent),
         trading_enabled = COALESCE(@tradingEnabled, trading_enabled),
         starting_equity = COALESCE(@startingEquity, starting_equity),
         post_trade_prompt_enabled = COALESCE(@postTradePromptEnabled, post_trade_prompt_enabled),
         updated_at = @updatedAt
       WHERE id = 1`,
    )
    .run({
      mode: patch.mode ?? null,
      equity: patch.equity ?? null,
      cashBalance: patch.cashBalance ?? null,
      lockedBalance: patch.lockedBalance ?? null,
      fixedTradeSizeUsd: patch.fixedTradeSizeUsd ?? null,
      maxOpenPositions: patch.maxOpenPositions ?? null,
      lossLimitPercent: patch.lossLimitPercent ?? null,
      maxOptionStakeUsd: patch.maxOptionStakeUsd ?? null,
      optionDefaultDurationSeconds: patch.optionDefaultDurationSeconds ?? null,
      binarySessionGainLimitEnabled:
        patch.binarySessionGainLimitEnabled === undefined
          ? null
          : patch.binarySessionGainLimitEnabled
            ? 1
            : 0,
      binaryMaxSessionGainUsdt: patch.binaryMaxSessionGainUsdt ?? null,
      binaryMaxSessionGainPercent: patch.binaryMaxSessionGainPercent ?? null,
      tradingEnabled: patch.tradingEnabled === undefined ? null : patch.tradingEnabled ? 1 : 0,
      startingEquity: patch.startingEquity ?? null,
      postTradePromptEnabled:
        patch.postTradePromptEnabled === undefined ? null : patch.postTradePromptEnabled ? 1 : 0,
      updatedAt: now(),
    });
  return getAccount();
}

/* -------------------------------- positions ------------------------------- */

/** Inserts a new OPEN position and returns it (with its id). */
export function createPosition(input: NewPosition): Position {
  const createdAt = now();
  const result = getDb()
    .prepare<
      {
        symbol: string;
        side: string;
        strikePrice: number;
        expiry: string;
        quantity: number;
        entryPremium: number;
        openedAt: string;
        createdAt: string;
        durationSeconds: number | null;
        expiresAt: string | null;
        source: string;
        stakeUsd: number;
        optionType: string;
      },
      unknown
    >(
      `INSERT INTO positions
         (symbol, side, strike_price, expiry, quantity, entry_premium, status, opened_at, created_at,
          duration_seconds, expires_at, source, stake_usd, option_type, settlement_status)
       VALUES
         (@symbol, @side, @strikePrice, @expiry, @quantity, @entryPremium, 'OPEN', @openedAt, @createdAt,
          @durationSeconds, @expiresAt, @source, @stakeUsd, @optionType, 'OPEN')`,
    )
    .run({
      symbol: input.symbol,
      side: input.side,
      strikePrice: input.strikePrice,
      expiry: input.expiry,
      quantity: input.quantity,
      entryPremium: input.entryPremium,
      openedAt: input.openedAt,
      durationSeconds: input.durationSeconds ?? null,
      expiresAt: input.expiresAt ?? null,
      source: input.source ?? 'MANUAL',
      stakeUsd: input.stakeUsd ?? Math.round(input.entryPremium * input.quantity * 100) / 100,
      optionType: input.optionType ?? 'CLASSIC',
      createdAt,
    });

  const position = getPositionById(Number(result.lastInsertRowid));
  if (!position) {
    throw new Error('Failed to read back the created position');
  }
  return position;
}

export function getPositionById(id: number): Position | null {
  const row = getDb().prepare<[number], PositionRow>('SELECT * FROM positions WHERE id = ?').get(id);
  return row ? toPosition(row) : null;
}

/** Lists positions, optionally filtered by status. */
export function listPositions(status?: PositionStatus): Position[] {
  const db = getDb();
  const rows = status
    ? db.prepare<[PositionStatus], PositionRow>('SELECT * FROM positions WHERE status = ?').all(status)
    : db.prepare<[], PositionRow>('SELECT * FROM positions ORDER BY id DESC').all();
  return rows.map(toPosition);
}

type PositionBind = {
  status: Position['status'] | null;
  exitPremium: number | null;
  realizedPnl: number | null;
  closedAt: string | null;
  settledAt: string | null;
  settlementPrice: number | null;
  settlementStatus: string | null;
  settlementReason: string | null;
  id: number;
};

/** Applies a partial update (e.g. closing a position) and returns the result. */
export function updatePosition(id: number, patch: PositionUpdate): Position | null {
  getDb()
    .prepare<PositionBind, unknown>(
      `UPDATE positions SET
         status = COALESCE(@status, status),
         exit_premium = COALESCE(@exitPremium, exit_premium),
         realized_pnl = COALESCE(@realizedPnl, realized_pnl),
         closed_at = COALESCE(@closedAt, closed_at),
         settled_at = COALESCE(@settledAt, settled_at),
         settlement_price = COALESCE(@settlementPrice, settlement_price),
         settlement_status = COALESCE(@settlementStatus, settlement_status),
         settlement_reason = COALESCE(@settlementReason, settlement_reason)
       WHERE id = @id`,
    )
    .run({
      status: patch.status ?? null,
      exitPremium: patch.exitPremium ?? null,
      realizedPnl: patch.realizedPnl ?? null,
      closedAt: patch.closedAt ?? null,
      settledAt: patch.settledAt ?? null,
      settlementPrice: patch.settlementPrice ?? null,
      settlementStatus: patch.settlementStatus ?? null,
      settlementReason: patch.settlementReason ?? null,
      id,
    });
  return getPositionById(id);
}

/**
 * Atomically claims an OPEN position for settlement. Returns true only for the
 * caller that won the claim, so concurrent settlement attempts can never
 * double-pay a position.
 */
export function claimPositionForSettlement(id: number): boolean {
  const result = getDb()
    .prepare<[number], unknown>(
      `UPDATE positions SET settlement_status = 'SETTLING'
       WHERE id = ? AND status = 'OPEN' AND (settlement_status IS NULL OR settlement_status = 'OPEN')`,
    )
    .run(id);
  return result.changes === 1;
}

/** Sum of the exact stakes of all OPEN classic positions. */
export function sumOpenPositionStakes(): number {
  const row = getDb()
    .prepare<[], { total: number | null }>(
      "SELECT SUM(COALESCE(stake_usd, ROUND(entry_premium * quantity, 2))) AS total FROM positions WHERE status = 'OPEN'",
    )
    .get();
  return Math.round((row?.total ?? 0) * 100) / 100;
}

/** Most recent CLOSED positions (settled / refunded history). */
export function listRecentClosedPositions(limit = 20): Position[] {
  return getDb()
    .prepare<[number], PositionRow>(
      "SELECT * FROM positions WHERE status = 'CLOSED' ORDER BY COALESCE(settled_at, closed_at) DESC, id DESC LIMIT ?",
    )
    .all(limit)
    .map(toPosition);
}

/** Net deposited capital: deposits minus withdrawals (total-loss-limit baseline). */
export function netDepositedCapital(): number {
  const row = getDb()
    .prepare<[], { total: number | null }>(
      "SELECT SUM(amount) AS total FROM transactions WHERE type IN ('DEPOSIT', 'WITHDRAWAL')",
    )
    .get();
  return Math.round((row?.total ?? 0) * 100) / 100;
}

/* ------------------------------ app settings ------------------------------ */

export interface AppSettingRow {
  key: string;
  value: string;
  updatedAt: string;
}

export function getAppSetting(key: string): AppSettingRow | null {
  const row = getDb()
    .prepare<[string], { key: string; value: string; updated_at: string }>(
      'SELECT key, value, updated_at FROM app_settings WHERE key = ?',
    )
    .get(key);
  return row ? { key: row.key, value: row.value, updatedAt: row.updated_at } : null;
}

/**
 * Upserts a setting and writes an audit row when the value changes. An empty
 * string deletes the setting (env/derived default applies again).
 */
export function setAppSetting(key: string, value: string): void {
  const db = getDb();
  db.transaction(() => {
    const previous = getAppSetting(key);
    if ((previous?.value ?? '') === value) {
      return;
    }
    const changedAt = now();
    if (value === '') {
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    } else {
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, value, changedAt);
    }
    db.prepare(
      'INSERT INTO settings_audit (key, old_value, new_value, changed_at) VALUES (?, ?, ?, ?)',
    ).run(key, previous?.value ?? null, value === '' ? null : value, changedAt);
  })();
}

/** Writes an audit row for a change stored outside app_settings (account columns). */
export function logSettingsAudit(key: string, oldValue: string | null, newValue: string | null): void {
  if (oldValue === newValue) {
    return;
  }
  getDb()
    .prepare('INSERT INTO settings_audit (key, old_value, new_value, changed_at) VALUES (?, ?, ?, ?)')
    .run(key, oldValue, newValue, now());
}

export function listSettingsAudit(limit = 50): SettingsAuditEntry[] {
  return getDb()
    .prepare<
      [number],
      { id: number; key: string; old_value: string | null; new_value: string | null; changed_at: string }
    >('SELECT * FROM settings_audit ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((r) => ({
      id: r.id,
      key: r.key,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedAt: r.changed_at,
    }));
}

/* ------------------------------- transactions ------------------------------ */

/** Logs a wallet movement and returns the stored row. */
export function logTransaction(input: NewTransaction): Transaction {
  const createdAt = now();
  const result = getDb()
    .prepare<NewTransaction & { createdAt: string }, unknown>(
      `INSERT INTO transactions (type, amount, currency, description, position_id, created_at)
       VALUES (@type, @amount, @currency, @description, @positionId, @createdAt)`,
    )
    .run({ ...input, createdAt });

  const row = getDb()
    .prepare<[number], TransactionRow>('SELECT * FROM transactions WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to read back the created transaction');
  }
  return toTransaction(row);
}

/** Lists the most recent transactions. */
export function listTransactions(limit = 100): Transaction[] {
  const rows = getDb()
    .prepare<[number], TransactionRow>('SELECT * FROM transactions ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map(toTransaction);
}

/* ------------------------------- ai decisions ------------------------------ */

type AiDecisionBind = {
  symbol: string;
  signal: AiDecision['signal'];
  action: AiDecision['action'];
  confidence: number;
  expectedReturn: number;
  proposedTradeSizeUsd: number;
  rationale: string | null;
  executed: number;
  positionId: number | null;
  createdAt: string;
  featuresJson: string | null;
};

/** Logs an AI signal/decision. */
export function logAiDecision(input: NewAiDecision): AiDecision {
  const createdAt = now();
  const result = getDb()
    .prepare<AiDecisionBind, unknown>(
      `INSERT INTO ai_decisions
         (symbol, signal, action, confidence, expected_return, proposed_trade_size_usd, rationale, executed, position_id, created_at, features_json)
       VALUES
         (@symbol, @signal, @action, @confidence, @expectedReturn, @proposedTradeSizeUsd, @rationale, @executed, @positionId, @createdAt, @featuresJson)`,
    )
    .run({
      symbol: input.symbol,
      signal: input.signal,
      action: input.action,
      confidence: input.confidence,
      expectedReturn: input.expectedReturn,
      proposedTradeSizeUsd: input.proposedTradeSizeUsd,
      rationale: input.rationale,
      executed: (input.executed ?? false) ? 1 : 0,
      positionId: input.positionId ?? null,
      createdAt,
      featuresJson: input.features ? JSON.stringify(input.features) : null,
    });

  const row = getDb()
    .prepare<[number], AiDecisionRow>('SELECT * FROM ai_decisions WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to read back the created AI decision');
  }
  return toAiDecision(row);
}

/** Lists the most recent AI decisions. */
export function listAiDecisions(limit = 100): AiDecision[] {
  const rows = getDb()
    .prepare<[number], AiDecisionRow>('SELECT * FROM ai_decisions ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map(toAiDecision);
}

export function getAiDecisionById(id: number): AiDecision | null {
  const row = getDb()
    .prepare<[number], AiDecisionRow>('SELECT * FROM ai_decisions WHERE id = ?')
    .get(id);
  return row ? toAiDecision(row) : null;
}

/**
 * Records the risk-engine / execution outcome on a decision (Phase 6.5.2):
 * merges `rejectionReason` into features_json and appends it to the
 * rationale so the UI shows exactly why a trade was not taken.
 */
export function recordAiDecisionRejection(id: number, reason: string): AiDecision | null {
  const current = getAiDecisionById(id);
  if (!current) {
    return null;
  }
  const features = current.features ? { ...current.features, rejectionReason: reason } : null;
  getDb()
    .prepare<[string | null, string, number], unknown>(
      'UPDATE ai_decisions SET features_json = ?, rationale = ? WHERE id = ?',
    )
    .run(
      features ? JSON.stringify(features) : null,
      `${current.rationale ?? ''} | Blocked: ${reason}`.slice(0, 2000),
      id,
    );
  return getAiDecisionById(id);
}

/**
 * Most recent AI classic positions (newest first), used to compute the
 * trailing same-direction streak. Manual trades never count.
 */
export function listRecentAiPositions(limit: number): Array<{ side: Position['side']; openedAt: string }> {
  return getDb()
    .prepare<[number], { side: string; opened_at: string }>(
      "SELECT side, opened_at FROM positions WHERE source = 'AI' ORDER BY opened_at DESC, id DESC LIMIT ?",
    )
    .all(limit)
    .map((r) => ({ side: r.side as Position['side'], openedAt: r.opened_at }));
}

/** Marks a decision as executed and links it to the position it created. */
export function markAiDecisionExecuted(id: number, positionId: number | null): AiDecision | null {
  const result = getDb()
    .prepare<[number | null, number], unknown>(
      'UPDATE ai_decisions SET executed = 1, position_id = ? WHERE id = ?',
    )
    .run(positionId, id);
  if (result.changes === 0) {
    return null;
  }
  return getAiDecisionById(id);
}

/* -------------------------------- risk events ------------------------------ */

/** Logs a risk-engine trigger (e.g. a loss limit hit). */
export function logRiskEvent(input: NewRiskEvent): RiskEvent {
  const triggeredAt = now();
  const result = getDb()
    .prepare<NewRiskEvent & { triggeredAt: string }, unknown>(
      `INSERT INTO risk_events (type, message, equity_at_trigger, triggered_at)
       VALUES (@type, @message, @equityAtTrigger, @triggeredAt)`,
    )
    .run({ ...input, triggeredAt });

  const row = getDb()
    .prepare<[number], RiskEventRow>('SELECT * FROM risk_events WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to read back the created risk event');
  }
  return toRiskEvent(row);
}

/** Lists the most recent risk events. */
export function listRiskEvents(limit = 100): RiskEvent[] {
  const rows = getDb()
    .prepare<[number], RiskEventRow>('SELECT * FROM risk_events ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map(toRiskEvent);
}

/* --------------------------------- deposits -------------------------------- */

interface DepositRow {
  id: number;
  network: string;
  asset: string;
  token_standard: string;
  token_contract_address: string | null;
  amount: number;
  from_address: string | null;
  txid: string | null;
  status: string;
  confirmations: number;
  created_at: string;
  credited_at: string | null;
  notes: string | null;
}

const toDeposit = (r: DepositRow): Deposit => ({
  id: r.id,
  network: r.network,
  asset: r.asset,
  tokenStandard: r.token_standard,
  tokenContractAddress: r.token_contract_address ?? null,
  amount: r.amount,
  fromAddress: r.from_address,
  txid: r.txid,
  status: r.status as DepositStatus,
  confirmations: r.confirmations,
  createdAt: r.created_at,
  creditedAt: r.credited_at,
  notes: r.notes,
});

export interface NewDepositInput {
  network?: string;
  asset?: string;
  tokenStandard?: string;
  /** Phase 7.4: TRC20 contract the transfer was detected on. */
  tokenContractAddress?: string | null;
  amount: number;
  fromAddress?: string | null;
  txid?: string | null;
  status: DepositStatus;
  confirmations?: number;
  creditedAt?: string | null;
  notes?: string | null;
}

/**
 * Inserts a deposit. Returns null when a deposit with the same txid already
 * exists (idempotency guard against double crediting).
 */
export function createDeposit(input: NewDepositInput): Deposit | null {
  const createdAt = now();
  const result = getDb()
    .prepare<
      {
        network: string;
        asset: string;
        tokenStandard: string;
        tokenContractAddress: string | null;
        amount: number;
        fromAddress: string | null;
        txid: string | null;
        status: string;
        confirmations: number;
        createdAt: string;
        creditedAt: string | null;
        notes: string | null;
      },
      unknown
    >(
      `INSERT OR IGNORE INTO deposits
         (network, asset, token_standard, token_contract_address, amount, from_address, txid, status, confirmations, created_at, credited_at, notes)
       VALUES
         (@network, @asset, @tokenStandard, @tokenContractAddress, @amount, @fromAddress, @txid, @status, @confirmations, @createdAt, @creditedAt, @notes)`,
    )
    .run({
      network: input.network ?? 'TRON',
      asset: input.asset ?? 'USDT',
      tokenStandard: input.tokenStandard ?? 'TRC20',
      tokenContractAddress: input.tokenContractAddress ?? null,
      amount: input.amount,
      fromAddress: input.fromAddress ?? null,
      txid: input.txid ?? null,
      status: input.status,
      confirmations: input.confirmations ?? 0,
      createdAt,
      creditedAt: input.creditedAt ?? null,
      notes: input.notes ?? null,
    });

  if (result.changes === 0) {
    return null;
  }
  const row = getDb()
    .prepare<[number], DepositRow>('SELECT * FROM deposits WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  return row ? toDeposit(row) : null;
}

export function listDeposits(limit = 50): Deposit[] {
  const rows = getDb()
    .prepare<[number], DepositRow>('SELECT * FROM deposits ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map(toDeposit);
}

/* -------------------------------- withdrawals ------------------------------ */

interface WithdrawalRow {
  id: number;
  network: string;
  asset: string;
  token_standard: string;
  token_contract_address: string | null;
  amount: number;
  destination_address: string;
  status: string;
  txid: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
  fee_estimate_trx: number | null;
  fee_estimate_usd: number | null;
  fee_payer: string | null;
  fee_status: string | null;
  fee_notes: string | null;
}

const toWithdrawal = (r: WithdrawalRow): Withdrawal => ({
  id: r.id,
  network: r.network,
  asset: r.asset,
  tokenStandard: r.token_standard,
  tokenContractAddress: r.token_contract_address ?? null,
  amount: r.amount,
  destinationAddress: r.destination_address,
  status: r.status as WithdrawalStatus,
  txid: r.txid,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  notes: r.notes,
  feeEstimateTrx: r.fee_estimate_trx,
  feeEstimateUsd: r.fee_estimate_usd,
  feePayer: r.fee_payer,
  feeStatus: r.fee_status,
  feeNotes: r.fee_notes,
});

export interface NewWithdrawalInput {
  amount: number;
  destinationAddress: string;
  status: WithdrawalStatus;
  /** Phase 7.4: TRC20 contract the withdrawal targets. */
  tokenContractAddress?: string | null;
  txid?: string | null;
  error?: string | null;
  notes?: string | null;
  feeEstimateTrx?: number | null;
  feeEstimateUsd?: number | null;
  feePayer?: string | null;
  feeStatus?: string | null;
  feeNotes?: string | null;
  feeReserveSufficient?: boolean | null;
  feeReserveError?: string | null;
}

export function createWithdrawal(input: NewWithdrawalInput): Withdrawal {
  const timestamp = now();
  const result = getDb()
    .prepare<
      {
        amount: number;
        destinationAddress: string;
        status: string;
        tokenContractAddress: string | null;
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
        feeReserveSufficient: number | null;
        feeReserveError: string | null;
      },
      unknown
    >(
      `INSERT INTO withdrawals
         (network, asset, token_standard, token_contract_address, amount, destination_address, status, txid, error, created_at, updated_at, notes,
          fee_estimate_trx, fee_estimate_usd, fee_payer, fee_status, fee_notes,
          fee_reserve_sufficient, fee_reserve_error)
       VALUES
         ('TRON', 'USDT', 'TRC20', @tokenContractAddress, @amount, @destinationAddress, @status, @txid, @error, @createdAt, @updatedAt, @notes,
          @feeEstimateTrx, @feeEstimateUsd, @feePayer, @feeStatus, @feeNotes,
          @feeReserveSufficient, @feeReserveError)`,
    )
    .run({
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      status: input.status,
      tokenContractAddress: input.tokenContractAddress ?? null,
      txid: input.txid ?? null,
      error: input.error ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: input.notes ?? null,
      feeEstimateTrx: input.feeEstimateTrx ?? null,
      feeEstimateUsd: input.feeEstimateUsd ?? null,
      feePayer: input.feePayer ?? null,
      feeStatus: input.feeStatus ?? null,
      feeNotes: input.feeNotes ?? null,
      feeReserveSufficient:
        input.feeReserveSufficient === undefined || input.feeReserveSufficient === null
          ? null
          : input.feeReserveSufficient
            ? 1
            : 0,
      feeReserveError: input.feeReserveError ?? null,
    });

  const row = getDb()
    .prepare<[number], WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to read back the created withdrawal');
  }
  return toWithdrawal(row);
}

export function getWithdrawalById(id: number): Withdrawal | null {
  const row = getDb()
    .prepare<[number], WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?')
    .get(id);
  return row ? toWithdrawal(row) : null;
}

export function updateWithdrawalStatus(
  id: number,
  status: WithdrawalStatus,
  extra: { txid?: string | null; error?: string | null } = {},
): Withdrawal | null {
  getDb()
    .prepare<[string, string | null, string | null, string, number], unknown>(
      `UPDATE withdrawals SET status = ?, txid = COALESCE(?, txid), error = COALESCE(?, error), updated_at = ? WHERE id = ?`,
    )
    .run(status, extra.txid ?? null, extra.error ?? null, now(), id);
  return getWithdrawalById(id);
}

export function listWithdrawals(limit = 50): Withdrawal[] {
  const rows = getDb()
    .prepare<[number], WithdrawalRow>('SELECT * FROM withdrawals ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map(toWithdrawal);
}

/* --------------------------- tron status checks ---------------------------- */

export interface NewTronStatusCheck {
  mode: string;
  networkName: string;
  connectionStatus: string;
  readyToTrade: boolean;
  trxBalance: number;
  energyAvailable: number;
  bandwidthAvailable: number;
  warnings: string;
}

export function logTronStatusCheck(input: NewTronStatusCheck): void {
  getDb()
    .prepare<Omit<NewTronStatusCheck, 'readyToTrade'> & { readyToTrade: number; checkedAt: string }, unknown>(
      `INSERT INTO tron_status_checks
         (checked_at, mode, network_name, connection_status, ready_to_trade,
          trx_balance, energy_available, bandwidth_available, warnings)
       VALUES
         (@checkedAt, @mode, @networkName, @connectionStatus, @readyToTrade,
          @trxBalance, @energyAvailable, @bandwidthAvailable, @warnings)`,
    )
    .run({ ...input, readyToTrade: input.readyToTrade ? 1 : 0, checkedAt: now() });
}

/* ------------------------------ wallet records ----------------------------- */

interface WalletRecordRow {
  id: string;
  kind: string;
  time: string;
  type: string;
  amount: number;
  asset: string;
  network: string | null;
  status: string;
  reference: string | null;
  txid: string | null;
  destination_address: string | null;
  deposit_address: string | null;
  fee_estimate_trx: number | null;
  fee_estimate_usd: number | null;
  fee_paid_by: string | null;
  notes: string | null;
}

const toWalletRecord = (r: WalletRecordRow): WalletRecord => ({
  id: r.id,
  kind: r.kind as WalletRecord['kind'],
  time: r.time,
  type: r.type,
  amount: r.amount,
  asset: r.asset,
  network: r.network,
  status: r.status,
  reference: r.reference,
  txid: r.txid,
  destinationAddress: r.destination_address,
  depositAddress: r.deposit_address,
  feeEstimateTrx: r.fee_estimate_trx,
  feeEstimateUsd: r.fee_estimate_usd,
  feePaidBy: r.fee_paid_by,
  notes: r.notes,
  // Phase 7: link to the ACTIVE network's explorer (Shasta/Nile on testnet).
  explorerUrl: explorerTxUrl(r.txid),
});

const WALLET_RECORD_KINDS = new Set(['ALL', 'DEPOSIT', 'WITHDRAWAL', 'TRADE', 'FEE', 'REFUND', 'FEE_DEPOSIT']);

/** Unified wallet history across transactions, deposits and withdrawals. */
export function listWalletRecords(kind: string | null, limit: number, offset: number): WalletRecord[] {
  // Allowlist the kind filter and bind it as a parameter — never interpolate
  // caller-provided strings into SQL.
  const safeKind = kind && WALLET_RECORD_KINDS.has(kind.toUpperCase()) ? kind.toUpperCase() : 'ALL';
  const rows = getDb()
    .prepare<[string, string, number, number], WalletRecordRow>(
      `SELECT * FROM (
         SELECT 'tx-' || id AS id, created_at AS time, type AS type, amount AS amount,
                currency AS asset, NULL AS network, 'RECORDED' AS status,
                NULL AS reference, NULL AS txid, NULL AS destination_address,
                NULL AS deposit_address, NULL AS fee_estimate_trx,
                NULL AS fee_estimate_usd, NULL AS fee_paid_by,
                description AS notes,
                CASE
                  WHEN type IN ('DEPOSIT', 'BINARY_WIN', 'AI_BINARY_WIN', 'OPTION_SETTLE_WIN', 'BINARY_REFUND', 'AI_BINARY_REFUND', 'OPTION_SETTLE_REFUND', 'REFUND') THEN 'DEPOSIT'
                  WHEN type IN ('WITHDRAWAL', 'BINARY_FEE') THEN 'FEE'
                  ELSE 'TRADE'
                END AS kind
           FROM transactions
         UNION ALL
         SELECT 'dep-' || id, created_at, 'DEPOSIT', amount, asset, network, status,
                txid, txid, NULL, NULL, NULL, NULL, NULL, notes, 'DEPOSIT'
           FROM deposits
         UNION ALL
         SELECT 'wd-' || id, created_at, 'WITHDRAWAL', -amount, asset, network, status,
                txid, txid, destination_address, NULL, fee_estimate_trx,
                fee_estimate_usd, fee_payer, notes, 'WITHDRAWAL'
           FROM withdrawals
         UNION ALL
         SELECT 'fee-' || id, created_at, 'TRX_FEE_DEPOSIT', amount_trx, asset, network, status,
                txid, txid, NULL, NULL, NULL, NULL, NULL, notes, 'FEE_DEPOSIT'
           FROM tron_fee_deposits
       )
       WHERE ? = 'ALL' OR kind = ?
       ORDER BY time DESC
       LIMIT ? OFFSET ?`,
    )
    .all(safeKind, safeKind, limit, offset);
  return rows.map(toWalletRecord);
}

export function getWalletRecordById(recordId: string): WalletRecord | null {
  return listWalletRecords('ALL', 10000, 0).find((record) => record.id === recordId) ?? null;
}




/* ----------------------------- TRX fee deposits ---------------------------- */

export interface TrxFeeDepositRow {
  id: number;
  network: string;
  asset: string;
  amount_trx: number;
  from_address: string | null;
  txid: string | null;
  status: string;
  confirmations: number;
  created_at: string;
  credited_at: string | null;
  notes: string | null;
}

const toTrxFeeDeposit = (r: TrxFeeDepositRow): TrxFeeDeposit => ({
  id: r.id,
  network: r.network,
  asset: r.asset,
  amountTrx: r.amount_trx,
  fromAddress: r.from_address,
  txid: r.txid,
  status: r.status as TrxFeeDeposit['status'],
  confirmations: r.confirmations,
  createdAt: r.created_at,
  creditedAt: r.credited_at,
  notes: r.notes,
});

export interface NewTrxFeeDepositInput {
  amountTrx: number;
  fromAddress?: string | null;
  txid?: string | null;
  status: TrxFeeDeposit['status'];
  confirmations?: number;
  creditedAt?: string | null;
  notes?: string | null;
}

/** Inserts a TRX fee deposit (txid is unique — duplicate detections are ignored). */
export function createTrxFeeDeposit(input: NewTrxFeeDepositInput): TrxFeeDeposit | null {
  const createdAt = now();
  const result = getDb()
    .prepare<
      {
        amountTrx: number;
        fromAddress: string | null;
        txid: string | null;
        status: string;
        confirmations: number;
        createdAt: string;
        creditedAt: string | null;
        notes: string | null;
      },
      unknown
    >(
      `INSERT OR IGNORE INTO tron_fee_deposits
         (network, asset, amount_trx, from_address, txid, status, confirmations, created_at, credited_at, notes)
       VALUES ('TRON', 'TRX', @amountTrx, @fromAddress, @txid, @status, @confirmations, @createdAt, @creditedAt, @notes)`,
    )
    .run({
      amountTrx: input.amountTrx,
      fromAddress: input.fromAddress ?? null,
      txid: input.txid ?? null,
      status: input.status,
      confirmations: input.confirmations ?? 0,
      createdAt,
      creditedAt: input.creditedAt ?? null,
      notes: input.notes ?? null,
    });
  if (result.changes === 0) {
    return null;
  }
  const row = getDb()
    .prepare<[number], TrxFeeDepositRow>('SELECT * FROM tron_fee_deposits WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  return row ? toTrxFeeDeposit(row) : null;
}

export function listTrxFeeDeposits(limit = 50): TrxFeeDeposit[] {
  const rows = getDb()
    .prepare<[number], TrxFeeDepositRow>('SELECT * FROM tron_fee_deposits ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map(toTrxFeeDeposit);
}

/** Total credited TRX in the fee reserve (simulated reserve accounting). */
export function feeWalletTrxBalance(): number {
  const row = getDb()
    .prepare<[], { total: number | null }>(
      "SELECT SUM(amount_trx) AS total FROM tron_fee_deposits WHERE status IN ('CONFIRMED', 'CREDITED')",
    )
    .get();
  return row?.total ?? 0;
}
