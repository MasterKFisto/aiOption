import type { ClassicDirectionState } from '@aioption/shared';

import { listRecentAiPositions, logRiskEvent, getAccount } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { getStrategySettings } from './classicStrategySettings.js';

export type Direction = 'CALL' | 'PUT';

export interface StreakCounts {
  consecutivePutCount: number;
  consecutiveCallCount: number;
}

export interface DirectionVerdict {
  allowed: boolean;
  reason: string | null;
}

/**
 * Anti one-sided-loop controls for the Classic AI (Phase 6.5.2):
 *
 * 1. Max consecutive same-direction trades: if the last N AI classic trades
 *    (open or settled) were all PUT, a new PUT is blocked (CALL / NEUTRAL
 *    still allowed) — and vice versa. When the limit is hit, that direction
 *    stays blocked for the configured cooldown, even if the streak is broken.
 * 2. Neutral cooldown on direction flips: after a run in one direction the AI
 *    must emit at least one NEUTRAL signal before it may open the opposite
 *    direction (prevents whipsawing CALL/PUT/CALL on noise).
 * 3. Rebalance (Phase 6.5.2 fix): when the preferred direction is blocked,
 *    the signal engine takes the OPPOSITE side (if RSI allows it), so the AI
 *    keeps trading both CALL and PUT instead of stalling. Opening the
 *    opposite side ends the blocked side's cooldown (the streak is broken),
 *    so the two sides can never both be blocked — no deadlock, no cap on the
 *    number of trades.
 */
export class DirectionGuard {
  private readonly blockedUntil: Record<Direction, number> = { CALL: 0, PUT: 0 };
  /**
   * When a direction's cooldown was imposed. Trades opened before this
   * moment no longer count toward that direction's streak, so once the
   * cooldown ends the direction is genuinely allowed again (bug fix: the
   * streak used to be recomputed from history and re-block forever).
   */
  private readonly streakResetAt: Record<Direction, number> = { CALL: 0, PUT: 0 };
  private lastDirectional: Direction | null = null;
  private neutralSeen = true;

  constructor(private readonly now: () => number = Date.now) {}

  /** Trailing same-direction streak from the most recent AI positions. */
  streak(): StreakCounts {
    const settings = getStrategySettings();
    const recent = listRecentAiPositions(Math.max(settings.maxConsecutiveSameDirection, 1) + 20);
    const first = recent[0]?.side;
    let count = 0;
    for (const position of recent) {
      if (position.side !== first) break;
      if (first && new Date(position.openedAt).getTime() < this.streakResetAt[first]) break;
      count += 1;
    }
    return {
      consecutivePutCount: first === 'PUT' ? count : 0,
      consecutiveCallCount: first === 'CALL' ? count : 0,
    };
  }

  /** The other direction. */
  static opposite(direction: Direction): Direction {
    return direction === 'CALL' ? 'PUT' : 'CALL';
  }

  /** Feeds every evaluated signal (incl. NEUTRAL) into the flip guard. */
  observeSignal(signal: Direction | 'NEUTRAL'): void {
    if (signal === 'NEUTRAL') {
      this.neutralSeen = true;
    }
  }

  /** Strategy-level flip check: needs a NEUTRAL between opposite directions. */
  flipBlocked(signal: Direction): string | null {
    const settings = getStrategySettings();
    if (
      settings.requireNeutralCooldown &&
      this.lastDirectional !== null &&
      this.lastDirectional !== signal &&
      !this.neutralSeen
    ) {
      return `Direction flip ${this.lastDirectional} → ${signal} requires a NEUTRAL signal first`;
    }
    return null;
  }

  /** Risk-level check for a proposed direction (consecutive limit + cooldown). */
  check(direction: Direction): DirectionVerdict {
    const settings = getStrategySettings();
    const nowMs = this.now();
    if (this.blockedUntil[direction] > nowMs) {
      const minutes = Math.ceil((this.blockedUntil[direction] - nowMs) / 60_000);
      return {
        allowed: false,
        reason: `Max consecutive ${direction}s reached — ${direction} cooldown (${minutes} min left)`,
      };
    }
    const counts = this.streak();
    const same = direction === 'PUT' ? counts.consecutivePutCount : counts.consecutiveCallCount;
    if (same >= settings.maxConsecutiveSameDirection) {
      this.blockedUntil[direction] = nowMs + settings.cooldownAfterMaxConsecutiveMs;
      this.streakResetAt[direction] = nowMs;
      const message = `Max consecutive ${direction}s reached (${same}). Directional bias blocked.`;
      const event = logRiskEvent({
        type: 'CLASSIC_MAX_CONSECUTIVE_DIRECTION',
        message:
          `${message} ${direction} blocked for ` +
          `${Math.round(settings.cooldownAfterMaxConsecutiveMs / 60_000)} min; opposite side allowed.`,
        equityAtTrigger: getAccount().equity,
      });
      publishEvent('risk', event);
      return { allowed: false, reason: message };
    }
    return { allowed: true, reason: null };
  }

  /**
   * Records that a trade in `direction` was actually opened. Trading the
   * opposite side breaks the other side's streak, so its cooldown ends
   * immediately — both sides can never be blocked at once (deadlock fix),
   * and the AI simply alternates instead of stalling.
   */
  recordExecution(direction: Direction): void {
    this.lastDirectional = direction;
    this.neutralSeen = false;
    const opposite = DirectionGuard.opposite(direction);
    if (this.blockedUntil[opposite] > 0) {
      this.blockedUntil[opposite] = 0;
    }
  }

  /** Clears the streak cooldowns (e.g. when the user starts trading fresh). */
  reset(): void {
    this.blockedUntil.CALL = 0;
    this.blockedUntil.PUT = 0;
    this.streakResetAt.CALL = 0;
    this.streakResetAt.PUT = 0;
    this.lastDirectional = null;
    this.neutralSeen = true;
  }

  state(): ClassicDirectionState {
    const nowMs = this.now();
    const counts = this.streak();
    const iso = (ms: number) => (ms > nowMs ? new Date(ms).toISOString() : null);
    return {
      ...counts,
      putBlockedUntil: iso(this.blockedUntil.PUT),
      callBlockedUntil: iso(this.blockedUntil.CALL),
      lastDirectionalSignal: this.lastDirectional,
      neutralSeenSinceLastDirection: this.neutralSeen,
    };
  }
}

/** Singleton shared by the trading loop, risk engine and status route. */
export const directionGuard = new DirectionGuard();
