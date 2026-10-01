import type {
  Account,
  AccountUpdate,
  AiDecision,
  NewAiDecision,
  NewPosition,
  NewRiskEvent,
  NewTransaction,
  Position,
  PositionStatus,
  PositionUpdate,
  RiskEvent,
  Transaction,
} from '@aioption/shared';

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
});

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
});

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
      updatedAt: now(),
    });
  return getAccount();
}

/* -------------------------------- positions ------------------------------- */

/** Inserts a new OPEN position and returns it (with its id). */
export function createPosition(input: NewPosition): Position {
  const createdAt = now();
  const result = getDb()
    .prepare<NewPosition & { createdAt: string }, unknown>(
      `INSERT INTO positions
         (symbol, side, strike_price, expiry, quantity, entry_premium, status, opened_at, created_at)
       VALUES
         (@symbol, @side, @strikePrice, @expiry, @quantity, @entryPremium, 'OPEN', @openedAt, @createdAt)`,
    )
    .run({ ...input, createdAt });

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
         closed_at = COALESCE(@closedAt, closed_at)
       WHERE id = @id`,
    )
    .run({
      status: patch.status ?? null,
      exitPremium: patch.exitPremium ?? null,
      realizedPnl: patch.realizedPnl ?? null,
      closedAt: patch.closedAt ?? null,
      id,
    });
  return getPositionById(id);
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
};

/** Logs an AI signal/decision. */
export function logAiDecision(input: NewAiDecision): AiDecision {
  const createdAt = now();
  const result = getDb()
    .prepare<AiDecisionBind, unknown>(
      `INSERT INTO ai_decisions
         (symbol, signal, action, confidence, expected_return, proposed_trade_size_usd, rationale, executed, position_id, created_at)
       VALUES
         (@symbol, @signal, @action, @confidence, @expectedReturn, @proposedTradeSizeUsd, @rationale, @executed, @positionId, @createdAt)`,
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
