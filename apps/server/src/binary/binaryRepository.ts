import type {
  BinaryContract,
  BinaryContractStatus,
  BinaryDirection,
  BinaryResult,
} from '@aioption/shared';

import { getDb } from '../db/connection.js';

const now = (): string => new Date().toISOString();

interface BinaryContractRow {
  id: number;
  asset: string;
  direction: string;
  stake_usd: number;
  payout_ratio: number;
  potential_profit_usd: number;
  total_return_if_win_usd: number;
  entry_price: number;
  settlement_price: number | null;
  status: string;
  result: string | null;
  source: string;
  opened_at: string;
  expires_at: string;
  settled_at: string | null;
  market_data_source: string | null;
  rejection_reason: string | null;
  notes: string | null;
}

const toContract = (row: BinaryContractRow): BinaryContract => ({
  id: row.id,
  asset: row.asset,
  direction: row.direction as BinaryDirection,
  stakeUsd: row.stake_usd,
  payoutRatio: row.payout_ratio,
  potentialProfitUsd: row.potential_profit_usd,
  totalReturnIfWinUsd: row.total_return_if_win_usd,
  entryPrice: row.entry_price,
  settlementPrice: row.settlement_price,
  status: row.status as BinaryContractStatus,
  result: row.result as BinaryResult,
  source: row.source,
  openedAt: row.opened_at,
  expiresAt: row.expires_at,
  settledAt: row.settled_at,
  marketDataSource: row.market_data_source,
  rejectionReason: row.rejection_reason,
  notes: row.notes,
});

export interface NewBinaryContract {
  asset: string;
  direction: BinaryDirection;
  stakeUsd: number;
  payoutRatio: number;
  potentialProfitUsd: number;
  totalReturnIfWinUsd: number;
  entryPrice: number;
  openedAt: string;
  expiresAt: string;
  marketDataSource: string;
  source?: string;
  notes?: string | null;
}

export function createBinaryContract(input: NewBinaryContract): BinaryContract {
  const result = getDb()
    .prepare<
      {
        asset: string;
        direction: string;
        stakeUsd: number;
        payoutRatio: number;
        potentialProfitUsd: number;
        totalReturnIfWinUsd: number;
        entryPrice: number;
        openedAt: string;
        expiresAt: string;
        marketDataSource: string;
        source: string;
        notes: string | null;
      },
      unknown
    >(
      `INSERT INTO binary_contracts
         (asset, direction, stake_usd, payout_ratio, potential_profit_usd, total_return_if_win_usd,
          entry_price, status, source, opened_at, expires_at, market_data_source, notes)
       VALUES
         (@asset, @direction, @stakeUsd, @payoutRatio, @potentialProfitUsd, @totalReturnIfWinUsd,
          @entryPrice, 'OPEN', @source, @openedAt, @expiresAt, @marketDataSource, @notes)`,
    )
    .run({
      asset: input.asset,
      direction: input.direction,
      stakeUsd: input.stakeUsd,
      payoutRatio: input.payoutRatio,
      potentialProfitUsd: input.potentialProfitUsd,
      totalReturnIfWinUsd: input.totalReturnIfWinUsd,
      entryPrice: input.entryPrice,
      openedAt: input.openedAt,
      expiresAt: input.expiresAt,
      marketDataSource: input.marketDataSource,
      source: input.source ?? 'MANUAL_BINARY',
      notes: input.notes ?? null,
    });

  const contract = getBinaryContractById(Number(result.lastInsertRowid));
  if (!contract) {
    throw new Error('Failed to read back the created binary contract');
  }
  return contract;
}

export function getBinaryContractById(id: number): BinaryContract | null {
  const row = getDb()
    .prepare<[number], BinaryContractRow>('SELECT * FROM binary_contracts WHERE id = ?')
    .get(id);
  return row ? toContract(row) : null;
}

export function listOpenBinaryContracts(): BinaryContract[] {
  const rows = getDb()
    .prepare<[], BinaryContractRow>(
      "SELECT * FROM binary_contracts WHERE status = 'OPEN' ORDER BY expires_at ASC",
    )
    .all();
  return rows.map(toContract);
}

export function listDueBinaryContracts(nowIso: string): BinaryContract[] {
  const rows = getDb()
    .prepare<[string], BinaryContractRow>(
      "SELECT * FROM binary_contracts WHERE status = 'OPEN' AND expires_at <= ? ORDER BY expires_at ASC",
    )
    .all(nowIso);
  return rows.map(toContract);
}

export function listSettledBinaryContracts(limit = 50): BinaryContract[] {
  const rows = getDb()
    .prepare<[number], BinaryContractRow>(
      "SELECT * FROM binary_contracts WHERE status != 'OPEN' ORDER BY id DESC LIMIT ?",
    )
    .all(limit);
  return rows.map(toContract);
}

export function countOpenBinaryContracts(source?: string): number {
  const row = source
    ? getDb()
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM binary_contracts WHERE status = 'OPEN' AND source = ?",
        )
        .get(source)
    : getDb()
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM binary_contracts WHERE status = 'OPEN'",
        )
        .get();
  return row?.count ?? 0;
}

export function logBinaryEvent(
  contractId: number | null,
  eventType: string,
  message: string | null,
): void {
  getDb()
    .prepare<[number | null, string, string | null, string], unknown>(
      'INSERT INTO binary_events (contract_id, event_type, message, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(contractId, eventType, message, now());
}

/**
 * Atomically settles a contract (status must still be OPEN) — prevents
 * duplicate settlement from overlapping scheduler ticks.
 */
export function settleBinaryContract(
  id: number,
  outcome: {
    status: BinaryContractStatus;
    result: BinaryResult;
    settlementPrice: number;
    settledAt: string;
    notes?: string | null;
  },
): BinaryContract | null {
  const result = getDb()
    .prepare<[string, string | null, number, string, string | null, number], unknown>(
      `UPDATE binary_contracts
         SET status = ?, result = ?, settlement_price = ?, settled_at = ?, notes = COALESCE(?, notes)
       WHERE id = ? AND status = 'OPEN'`,
    )
    .run(
      outcome.status,
      outcome.result,
      outcome.settlementPrice,
      outcome.settledAt,
      outcome.notes ?? null,
      id,
    );
  if (result.changes === 0) {
    return null;
  }
  return getBinaryContractById(id);
}

/** Fails an OPEN contract (e.g. stale market data) — caller refunds the stake. */
export function markBinaryContractError(id: number, reason: string): BinaryContract | null {
  const result = getDb()
    .prepare<[string, string, number], unknown>(
      `UPDATE binary_contracts
         SET status = 'ERROR', rejection_reason = ?, settled_at = ?
       WHERE id = ? AND status = 'OPEN'`,
    )
    .run(reason, now(), id);
  if (result.changes === 0) {
    return null;
  }
  return getBinaryContractById(id);
}

/** Net realized PnL across settled binary contracts (WIN profit − LOSE stake). */
export function binaryNetPnl(): number {
  const row = getDb()
    .prepare<[], { pnl: number | null }>(
      `SELECT COALESCE(SUM(
         CASE
           WHEN status = 'SETTLED' AND result = 'WIN' THEN potential_profit_usd
           WHEN status = 'SETTLED' AND result = 'LOSE' THEN -stake_usd
           ELSE 0
         END
       ), 0) AS pnl
       FROM binary_contracts`,
    )
    .get();
  return row?.pnl ?? 0;
}

/* -------------------------- binary session stats ---------------------------- */

export interface BinarySessionRow {
  id: number;
  session_started_at: string;
  session_reset_at: string | null;
  manual_net_gain: number;
  ai_net_gain: number;
  combined_net_gain: number;
  wins: number;
  losses: number;
  refunds: number;
  gain_limit_reached: number;
  gain_limit_reason: string | null;
}

export function getLatestBinarySession(): BinarySessionRow | null {
  const row = getDb()
    .prepare<[], BinarySessionRow>('SELECT * FROM binary_session_stats ORDER BY id DESC LIMIT 1')
    .get();
  return row ?? null;
}

export function createBinarySession(): BinarySessionRow {
  const result = getDb()
    .prepare<[string], unknown>('INSERT INTO binary_session_stats (session_started_at) VALUES (?)')
    .run(new Date().toISOString());
  const row = getDb()
    .prepare<[number], BinarySessionRow>('SELECT * FROM binary_session_stats WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to read back the binary session');
  }
  return row;
}

/** Atomically increments the session counters. */
export function incrementBinarySessionStats(
  id: number,
  deltas: {
    manualNetGain?: number;
    aiNetGain?: number;
    wins?: number;
    losses?: number;
    refunds?: number;
  },
): BinarySessionRow | null {
  getDb()
    .prepare<[number, number, number, number, number, number, number], unknown>(
      `UPDATE binary_session_stats SET
         manual_net_gain = manual_net_gain + ?,
         ai_net_gain = ai_net_gain + ?,
         combined_net_gain = combined_net_gain + ?,
         wins = wins + ?,
         losses = losses + ?,
         refunds = refunds + ?
       WHERE id = ?`,
    )
    .run(
      deltas.manualNetGain ?? 0,
      deltas.aiNetGain ?? 0,
      (deltas.manualNetGain ?? 0) + (deltas.aiNetGain ?? 0),
      deltas.wins ?? 0,
      deltas.losses ?? 0,
      deltas.refunds ?? 0,
      id,
    );
  return getLatestBinarySession();
}

export function setBinarySessionGainLimitReached(id: number, reason: string): void {
  getDb()
    .prepare<[string, number], unknown>(
      'UPDATE binary_session_stats SET gain_limit_reached = 1, gain_limit_reason = ? WHERE id = ?',
    )
    .run(reason, id);
}

export function clearBinarySessionGainLimitReached(id: number): void {
  getDb()
    .prepare<[number], unknown>(
      'UPDATE binary_session_stats SET gain_limit_reached = 0, gain_limit_reason = NULL WHERE id = ?',
    )
    .run(id);
}

