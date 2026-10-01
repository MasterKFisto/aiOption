import type { AiBinaryDecision, AiBinaryMode, AiBinarySignal } from '@aioption/shared';

import { getDb } from '../db/connection.js';

const now = (): string => new Date().toISOString();

interface AiBinaryDecisionRow {
  id: number;
  created_at: string;
  asset: string;
  signal: string;
  confidence: number;
  reason: string | null;
  features_json: string | null;
  mode: string;
  auto_executed: number;
  rejection_reason: string | null;
  binary_contract_id: number | null;
  market_price: number;
  updated_at: string;
}

const toDecision = (row: AiBinaryDecisionRow): AiBinaryDecision => ({
  id: row.id,
  createdAt: row.created_at,
  asset: row.asset,
  signal: row.signal as AiBinarySignal,
  confidence: row.confidence,
  reason: row.reason,
  featuresJson: row.features_json,
  mode: row.mode as AiBinaryMode,
  autoExecuted: row.auto_executed === 1,
  rejectionReason: row.rejection_reason,
  binaryContractId: row.binary_contract_id,
  marketPrice: row.market_price,
  updatedAt: row.updated_at,
});

export interface NewAiBinaryDecision {
  asset: string;
  signal: AiBinarySignal;
  confidence: number;
  reason: string | null;
  featuresJson: string | null;
  mode: AiBinaryMode;
  autoExecuted?: boolean;
  rejectionReason?: string | null;
  binaryContractId?: number | null;
  marketPrice: number;
}

export function createAiBinaryDecision(input: NewAiBinaryDecision): AiBinaryDecision {
  const timestamp = now();
  const result = getDb()
    .prepare<
      {
        asset: string;
        signal: string;
        confidence: number;
        reason: string | null;
        featuresJson: string | null;
        mode: string;
        autoExecuted: number;
        rejectionReason: string | null;
        binaryContractId: number | null;
        marketPrice: number;
        createdAt: string;
        updatedAt: string;
      },
      unknown
    >(
      `INSERT INTO ai_binary_decisions
         (created_at, asset, signal, confidence, reason, features_json, mode,
          auto_executed, rejection_reason, binary_contract_id, market_price, updated_at)
       VALUES
         (@createdAt, @asset, @signal, @confidence, @reason, @featuresJson, @mode,
          @autoExecuted, @rejectionReason, @binaryContractId, @marketPrice, @updatedAt)`,
    )
    .run({
      asset: input.asset,
      signal: input.signal,
      confidence: input.confidence,
      reason: input.reason,
      featuresJson: input.featuresJson,
      mode: input.mode,
      autoExecuted: (input.autoExecuted ?? false) ? 1 : 0,
      rejectionReason: input.rejectionReason ?? null,
      binaryContractId: input.binaryContractId ?? null,
      marketPrice: input.marketPrice,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

  const row = getDb()
    .prepare<[number], AiBinaryDecisionRow>('SELECT * FROM ai_binary_decisions WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to read back the AI binary decision');
  }
  return toDecision(row);
}

export function updateAiBinaryDecisionExecution(
  id: number,
  binaryContractId: number | null,
): void {
  getDb()
    .prepare<[number | null, string, number], unknown>(
      'UPDATE ai_binary_decisions SET auto_executed = 1, binary_contract_id = ?, updated_at = ? WHERE id = ?',
    )
    .run(binaryContractId, now(), id);
}

export function updateAiBinaryDecisionRejection(id: number, reason: string): void {
  getDb()
    .prepare<[string, string, number], unknown>(
      'UPDATE ai_binary_decisions SET rejection_reason = ?, updated_at = ? WHERE id = ?',
    )
    .run(reason, now(), id);
}

export function listAiBinaryDecisions(limit = 50): AiBinaryDecision[] {
  const rows = getDb()
    .prepare<[number], AiBinaryDecisionRow>(
      'SELECT * FROM ai_binary_decisions ORDER BY id DESC LIMIT ?',
    )
    .all(limit);
  return rows.map(toDecision);
}

/** Recent signals, newest first (used for persistence checks). */
export function recentAiSignals(limit: number): Array<{ signal: AiBinarySignal }> {
  const rows = getDb()
    .prepare<[number], { signal: string }>(
      'SELECT signal FROM ai_binary_decisions ORDER BY id DESC LIMIT ?',
    )
    .all(limit);
  return rows.map((row) => ({ signal: row.signal as AiBinarySignal }));
}


/* ------------------------------ settings (KV) ------------------------------ */

export function getAiBinarySettings(): Record<string, string> {
  const rows = getDb()
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM ai_binary_settings')
    .all();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export function saveAiBinarySettings(patch: Record<string, string>): void {
  const timestamp = now();
  const stmt = getDb().prepare<[string, string, string], unknown>(
    'INSERT INTO ai_binary_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );
  for (const [key, value] of Object.entries(patch)) {
    stmt.run(key, value, timestamp);
  }
}

/* ----------------------------- session stats ------------------------------- */

export interface AiSessionRow {
  id: number;
  started_at: string;
  stopped_at: string | null;
  total_signals: number;
  total_trades: number;
  wins: number;
  losses: number;
  refunds: number;
  net_pnl: number;
  stop_reason: string | null;
  profit_target_usd: number | null;
  daily_profit_limit_percent: number | null;
  session_profit_usd: number | null;
  daily_profit_usd: number | null;
  profit_target_reached_at: string | null;
  stopped_by_profit_target: number | null;
}

export function createAiSession(): number {
  const result = getDb()
    .prepare<[string], unknown>('INSERT INTO ai_binary_stats (started_at) VALUES (?)')
    .run(now());
  return Number(result.lastInsertRowid);
}

export interface AiSessionStatsUpdate {
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  refunds: number;
  netPnl: number;
  sessionProfitUsd?: number;
  dailyProfitUsd?: number;
  profitTargetUsd?: number | null;
  dailyProfitLimitPercent?: number | null;
  profitTargetReachedAt?: string | null;
  stoppedByProfitTarget?: boolean;
}

export function updateAiSession(
  id: number,
  stats: AiSessionStatsUpdate,
  stopReason?: string | null,
): void {
  getDb()
    .prepare<
      [
        number,
        number,
        number,
        number,
        number,
        number,
        number | null,
        number | null,
        number | null,
        number | null,
        string | null,
        number | null,
        string | null,
        string | null,
        number,
      ],
      unknown
    >(
      `UPDATE ai_binary_stats SET
         total_signals = ?, total_trades = ?, wins = ?, losses = ?, refunds = ?,
         net_pnl = ?,
         session_profit_usd = COALESCE(?, session_profit_usd),
         daily_profit_usd = COALESCE(?, daily_profit_usd),
         profit_target_usd = COALESCE(?, profit_target_usd),
         daily_profit_limit_percent = COALESCE(?, daily_profit_limit_percent),
         profit_target_reached_at = COALESCE(?, profit_target_reached_at),
         stopped_by_profit_target = COALESCE(?, stopped_by_profit_target),
         stopped_at = COALESCE(?, stopped_at), stop_reason = COALESCE(?, stop_reason)
       WHERE id = ?`,
    )
    .run(
      stats.totalSignals,
      stats.totalTrades,
      stats.wins,
      stats.losses,
      stats.refunds,
      stats.netPnl,
      stats.sessionProfitUsd ?? null,
      stats.dailyProfitUsd ?? null,
      stats.profitTargetUsd ?? null,
      stats.dailyProfitLimitPercent ?? null,
      stats.profitTargetReachedAt ?? null,
      stats.stoppedByProfitTarget === undefined ? null : stats.stoppedByProfitTarget ? 1 : 0,
      stopReason ?? null,
      stopReason ?? null,
      id,
    );
}

export function getAiSession(id: number): AiSessionRow | null {
  const row = getDb()
    .prepare<[number], AiSessionRow>('SELECT * FROM ai_binary_stats WHERE id = ?')
    .get(id);
  return row ?? null;
}

/** Net realized PnL of AI binary contracts settled since `sinceIso`. */
export function getAiBinaryProfitSince(sinceIso: string): number {
  const row = getDb()
    .prepare<[string], { pnl: number | null }>(
      `SELECT
         SUM(CASE result
           WHEN 'WIN' THEN potential_profit_usd
           WHEN 'LOSE' THEN -stake_usd
           ELSE 0
         END) AS pnl
       FROM binary_contracts
       WHERE source = 'AI_BINARY' AND status = 'SETTLED' AND settled_at >= ?`,
    )
    .get(sinceIso);
  return row?.pnl ?? 0;
}

/** Session profit from the latest AI binary session row. */
export function latestAiSessionProfit(): number {
  const row = getDb()
    .prepare<[], { session_profit_usd: number | null }>(
      'SELECT session_profit_usd FROM ai_binary_stats ORDER BY id DESC LIMIT 1',
    )
    .get();
  return row?.session_profit_usd ?? 0;
}
