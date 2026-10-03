import type { BinaryContract, BinarySessionSettingsUpdate, BinarySessionStats } from '@aioption/shared';

import { config } from '../config.js';
import { getAccount, logRiskEvent, updateAccount } from '../db/repositories.js';
import { publishEvent, subscribeToEvents } from '../events/eventBus.js';
import { logger } from '../logger.js';
import {
  clearBinarySessionGainLimitReached,
  createBinarySession,
  getLatestBinarySession,
  incrementBinarySessionStats,
  setBinarySessionGainLimitReached,
} from './binaryRepository.js';

/**
 * Tracks the combined (manual + AI) binary session net gain and enforces the
 * max-session-gain limit: settlement events from the Phase 6.2 engine update
 * the session stats; the binary service and the AI module consult the limit
 * before opening new contracts.
 */
export class BinarySessionService {
  private sessionId: number;
  private readonly unsubscribe: () => void;

  constructor() {
    // BINARY_SESSION_RESET_ON_START=true starts a fresh session on boot;
    // otherwise the latest session continues across restarts.
    const latest = getLatestBinarySession();
    if (!latest || config.BINARY_SESSION_RESET_ON_START) {
      this.sessionId = createBinarySession().id;
    } else {
      this.sessionId = latest.id;
    }
    this.unsubscribe = subscribeToEvents((event) => {
      if (event.type === 'binary') {
        const payload = event.payload as
          | { action?: string; contract?: BinaryContract }
          | undefined;
        if (payload?.action === 'SETTLED' && payload.contract) {
          this.onSettled(payload.contract);
        }
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private onSettled(contract: BinaryContract): void {
    if (contract.result === 'WIN') {
      incrementBinarySessionStats(this.sessionId, {
        ...(contract.source === 'AI_BINARY'
          ? { aiNetGain: contract.potentialProfitUsd }
          : { manualNetGain: contract.potentialProfitUsd }),
        wins: 1,
      });
    } else if (contract.result === 'LOSE') {
      incrementBinarySessionStats(this.sessionId, {
        ...(contract.source === 'AI_BINARY'
          ? { aiNetGain: -contract.stakeUsd }
          : { manualNetGain: -contract.stakeUsd }),
        losses: 1,
      });
    } else {
      incrementBinarySessionStats(this.sessionId, { refunds: 1 });
    }
    // Mark the limit reached exactly once.
    const stats = this.getStats();
    if (stats.gainLimitEnabled && stats.combinedNetGain >= this.effectiveLimitUsd()) {
      const session = getLatestBinarySession();
      if (session && session.gain_limit_reached !== 1) {
        const reason = `combined binary session gain ${stats.combinedNetGain.toFixed(2)} reached the limit`;
        setBinarySessionGainLimitReached(this.sessionId, reason);
        logRiskEvent({
          type: 'BINARY_SESSION_GAIN_LIMIT_REACHED',
          message: reason,
          equityAtTrigger: getAccount().equity,
        });
        logger.info({ reason }, 'binary session gain limit reached');
        publishEvent('binary', { action: 'SESSION_GAIN_LIMIT_REACHED', stats: this.getStats() });
      }
    }
  }

  private effectiveLimitUsd(): number {
    const account = getAccount();
    const usdtLimit = account.binaryMaxSessionGainUsdt;
    const percentLimitUsd =
      account.binaryMaxSessionGainPercent > 0 && account.startingEquity > 0
        ? account.startingEquity * (account.binaryMaxSessionGainPercent / 100)
        : Number.POSITIVE_INFINITY;
    return Math.min(usdtLimit, percentLimitUsd);
  }

  isGainLimitEnabled(): boolean {
    return config.BINARY_SESSION_GAIN_LIMIT_ENABLED && getAccount().binarySessionGainLimitEnabled;
  }

  isGainLimitReached(): boolean {
    if (!this.isGainLimitEnabled()) {
      return false;
    }
    const session = getLatestBinarySession();
    if (!session) {
      return false;
    }
    return session.combined_net_gain >= this.effectiveLimitUsd();
  }

  getStats(): BinarySessionStats {
    const session = getLatestBinarySession();
    const account = getAccount();
    const enabled = this.isGainLimitEnabled();
    const limitUsd = enabled ? this.effectiveLimitUsd() : 0;
    const combined = session?.combined_net_gain ?? 0;
    return {
      sessionStartedAt: session?.session_started_at ?? new Date().toISOString(),
      manualNetGain: session?.manual_net_gain ?? 0,
      aiNetGain: session?.ai_net_gain ?? 0,
      combinedNetGain: combined,
      wins: session?.wins ?? 0,
      losses: session?.losses ?? 0,
      refunds: session?.refunds ?? 0,
      gainLimitEnabled: enabled,
      maxSessionGainUsdt: enabled ? account.binaryMaxSessionGainUsdt : 0,
      maxSessionGainPercent: enabled ? account.binaryMaxSessionGainPercent : 0,
      remainingSessionGain: enabled ? Math.max(0, limitUsd - combined) : 0,
      gainLimitReached: this.isGainLimitReached(),
      gainLimitReason: session?.gain_limit_reason ?? null,
    };
  }


  updateSettings(patch: BinarySessionSettingsUpdate): BinarySessionStats {
    if (patch.maxSessionGainUsdt !== undefined) {
      if (!Number.isFinite(patch.maxSessionGainUsdt) || patch.maxSessionGainUsdt <= 0) {
        throw new Error('maxSessionGainUsdt must be positive');
      }
    }
    if (patch.maxSessionGainPercent !== undefined) {
      if (
        !Number.isFinite(patch.maxSessionGainPercent) ||
        patch.maxSessionGainPercent < 0 ||
        patch.maxSessionGainPercent > 100
      ) {
        throw new Error('maxSessionGainPercent must be between 0 and 100');
      }
    }
    updateAccount({
      ...(patch.gainLimitEnabled !== undefined
        ? { binarySessionGainLimitEnabled: patch.gainLimitEnabled }
        : {}),
      ...(patch.maxSessionGainUsdt !== undefined
        ? { binaryMaxSessionGainUsdt: patch.maxSessionGainUsdt }
        : {}),
      ...(patch.maxSessionGainPercent !== undefined
        ? { binaryMaxSessionGainPercent: patch.maxSessionGainPercent }
        : {}),
    });
    // Raising the limit above the current gain (or disabling it) unblocks.
    const session = getLatestBinarySession();
    if (session && session.gain_limit_reached === 1 && !this.isGainLimitReached()) {
      clearBinarySessionGainLimitReached(session.id);
    }
    publishEvent('binary', { action: 'SESSION_SETTINGS_UPDATED', stats: this.getStats() });
    return this.getStats();
  }

  resetSession(): BinarySessionStats {
    this.sessionId = createBinarySession().id;
    logRiskEvent({
      type: 'BINARY_SESSION_RESET',
      message: 'binary session gain statistics reset by the user',
      equityAtTrigger: getAccount().equity,
    });
    publishEvent('binary', { action: 'SESSION_RESET', stats: this.getStats() });
    return this.getStats();
  }
}

let sharedSessionService: BinarySessionService | null = null;

/** Lazily creates the shared binary session service (requires DB init first). */
export function getBinarySessionService(): BinarySessionService {
  if (!sharedSessionService) {
    sharedSessionService = new BinarySessionService();
  }
  return sharedSessionService;
}
