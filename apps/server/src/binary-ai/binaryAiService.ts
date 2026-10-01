import type {
  AiBinaryDecision,
  AiBinaryMode,
  AiBinarySettingsUpdate,
  AiBinaryStats,
  AiBinaryStatus,
  BinaryContract,
} from '@aioption/shared';

import { countOpenBinaryContracts } from '../binary/binaryRepository.js';
import { getBinarySessionService } from '../binary/binarySessionService.js';
import { binaryService } from '../binary/binaryService.js';
import type { BinaryService } from '../binary/binaryService.js';
import { config } from '../config.js';
import { getAccount, logRiskEvent } from '../db/repositories.js';
import { publishEvent, subscribeToEvents } from '../events/eventBus.js';
import { logger } from '../logger.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import {
  createAiBinaryDecision,
  createAiSession,
  getAiBinaryProfitSince,
  getAiBinarySettings,
  listAiBinaryDecisions,
  recentAiSignals,
  saveAiBinarySettings,
  updateAiBinaryDecisionExecution,
  updateAiBinaryDecisionRejection,
  updateAiSession,
} from './binaryAiRepository.js';
import { generateAiSignal } from './binaryAiStrategy.js';
import type { AiTickFeed } from './binaryAiTypes.js';

export interface AiRuntimeSettings {
  mode: AiBinaryMode;
  stakeUsd: number;
  durationSeconds: number;
  payoutRatio: number;
  minConfidence: number;
  maxOpenContracts: number;
  maxSessionLossUsd: number;
  profitTargetEnabled: boolean;
  profitTargetUsd: number;
  dailyProfitLimitPercent: number;
  stopOnProfitTarget: boolean;
}

export type AiStopReason =
  | 'USER'
  | 'LOSS_LIMIT'
  | 'DAILY_LOSS_LIMIT'
  | 'CONSECUTIVE_LOSSES'
  | 'SESSION_LOSS_LIMIT'
  | 'PROFIT_TARGET'
  | 'SESSION_GAIN_LIMIT';

const STOP_RISK_EVENTS = {
  USER: 'AI_BINARY_STOPPED_BY_USER',
  LOSS_LIMIT: 'AI_BINARY_STOPPED_BY_LOSS_LIMIT',
  DAILY_LOSS_LIMIT: 'AI_BINARY_STOPPED_BY_DAILY_LOSS_LIMIT',
  CONSECUTIVE_LOSSES: 'AI_BINARY_STOPPED_BY_CONSECUTIVE_LOSSES',
  SESSION_LOSS_LIMIT: 'AI_BINARY_STOPPED_BY_SESSION_LOSS_LIMIT',
  PROFIT_TARGET: 'AI_BINARY_STOPPED_BY_PROFIT_TARGET',
  SESSION_GAIN_LIMIT: 'AI_BINARY_STOPPED_BY_SESSION_GAIN_LIMIT',
} as const;

const emptyStats = (): AiBinaryStats => ({
  totalSignals: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  refunds: 0,
  netPnl: 0,
  consecutiveLosses: 0,
  sessionLossUsd: 0,
  sessionProfitUsd: 0,
  dailyProfitUsd: 0,
  profitTargetUsd: 0,
  dailyProfitLimitPercent: 0,
  remainingProfitUntilTarget: 0,
  profitTargetReachedAt: null,
  stoppedByProfitTarget: false,
});

/**
 * AI binary trading service. Generates short-term signals from the live tick
 * buffer and (in AUTO_EXECUTE mode) opens Phase 6.2 binary contracts through
 * the existing BinaryService. Settlement is handled by the Phase 6.2 engine;
 * this service only listens to its events to track session performance.
 */
export class AiBinaryService {
  private running = false;
  private settings: AiRuntimeSettings;
  private stats: AiBinaryStats = emptyStats();
  private currentSignal: {
    signal: 'UP' | 'DOWN' | 'NEUTRAL';
    confidence: number;
    reason: string;
    at: string;
  } | null = null;
  private lastSignalAt: string | null = null;
  private lastTradeAt: number | null = null;
  private lastLossAt: number | null = null;
  private tradeTimestamps: number[] = [];
  private sessionId: number | null = null;
  private warnings: string[] = [];
  private stopReason: AiStopReason | null = null;
  private lastRejectionReason: string | null = null;
  private staleLogged = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly feed: AiTickFeed = liveMarket,
    private readonly binary: BinaryService,
  ) {
    this.settings = this.parseStoredSettings(getAiBinarySettings());
    // Track settlements of AI contracts published by the Phase 6.2 engine.
    this.unsubscribe = subscribeToEvents((event) => {
      if (event.type === 'binary') {
        const payload = event.payload as
          | { action?: string; contract?: BinaryContract }
          | undefined;
        if (payload?.action === 'SETTLED' && payload.contract?.source === 'AI_BINARY') {
          this.handleAiSettled(payload.contract);
        }
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  /* ------------------------------ settings --------------------------------- */

  private parseStoredSettings(stored: Record<string, string>): AiRuntimeSettings {
    const number = (key: string, fallback: number): number => {
      const value = Number(stored[key]);
      return Number.isFinite(value) ? value : fallback;
    };
    const modeValue = stored['mode'];
    const mode: AiBinaryMode =
      modeValue === 'DISABLED' || modeValue === 'SIGNAL_ONLY' || modeValue === 'AUTO_EXECUTE'
        ? modeValue
        : config.AI_BINARY_MODE;
    return {
      mode,
      stakeUsd: number('stake_usd', config.AI_BINARY_STAKE_USD),
      durationSeconds: number('duration_seconds', config.AI_BINARY_DURATION_SECONDS),
      payoutRatio: number('payout_ratio', config.AI_BINARY_PAYOUT_RATIO),
      minConfidence: number('min_confidence', config.AI_BINARY_MIN_CONFIDENCE),
      maxOpenContracts: number('max_open_contracts', config.AI_BINARY_MAX_OPEN_CONTRACTS),
      maxSessionLossUsd: number('max_session_loss_usd', config.AI_BINARY_MAX_SESSION_LOSS_USD),
      profitTargetEnabled:
        stored['profit_target_enabled'] !== undefined
          ? stored['profit_target_enabled'] === 'true'
          : config.AI_BINARY_PROFIT_TARGET_ENABLED,
      profitTargetUsd: number('profit_target_usd', config.AI_BINARY_PROFIT_TARGET_USD),
      dailyProfitLimitPercent: number(
        'daily_profit_limit_percent',
        config.AI_BINARY_DAILY_PROFIT_LIMIT_PERCENT,
      ),
      stopOnProfitTarget:
        stored['stop_on_profit_target'] !== undefined
          ? stored['stop_on_profit_target'] === 'true'
          : config.AI_BINARY_STOP_ON_PROFIT_TARGET,
    };
  }


  updateSettings(patch: AiBinarySettingsUpdate): AiBinaryStatus {
    if (patch.mode !== undefined) {
      if (!['DISABLED', 'SIGNAL_ONLY', 'AUTO_EXECUTE'].includes(patch.mode)) {
        throw new Error(`invalid mode: ${patch.mode}`);
      }
      if (
        patch.mode === 'AUTO_EXECUTE' &&
        config.MODE !== 'PAPER' &&
        !config.AI_BINARY_LIVE_AUTO_TRADING_ENABLED
      ) {
        throw new Error(
          'AI auto-execution outside PAPER mode requires AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true',
        );
      }
      this.settings.mode = patch.mode;
      // Switching to DISABLED stops the engine immediately for a clean state.
      if (patch.mode === 'DISABLED' && this.running) {
        this.stop('USER');
      }
    }
    if (patch.stakeUsd !== undefined) {
      if (
        !Number.isFinite(patch.stakeUsd) ||
        patch.stakeUsd < config.BINARY_MIN_STAKE_USD ||
        patch.stakeUsd > config.BINARY_MAX_STAKE_USD
      ) {
        throw new Error(
          `stakeUsd must be between ${config.BINARY_MIN_STAKE_USD} and ${config.BINARY_MAX_STAKE_USD}`,
        );
      }
      this.settings.stakeUsd = patch.stakeUsd;
    }
    if (patch.durationSeconds !== undefined) {
      if (!config.BINARY_ALLOWED_DURATIONS_SECONDS.includes(patch.durationSeconds)) {
        throw new Error(
          `durationSeconds must be one of ${config.BINARY_ALLOWED_DURATIONS_SECONDS.join(', ')}`,
        );
      }
      this.settings.durationSeconds = patch.durationSeconds;
    }
    if (patch.payoutRatio !== undefined) {
      if (!config.BINARY_ALLOWED_PAYOUT_RATIOS.includes(patch.payoutRatio)) {
        throw new Error(
          `payoutRatio must be one of ${config.BINARY_ALLOWED_PAYOUT_RATIOS.join(', ')}`,
        );
      }
      this.settings.payoutRatio = patch.payoutRatio;
    }
    if (patch.minConfidence !== undefined) {
      if (
        !Number.isFinite(patch.minConfidence) ||
        patch.minConfidence < 0 ||
        patch.minConfidence > 1
      ) {
        throw new Error('minConfidence must be between 0 and 1');
      }
      this.settings.minConfidence = patch.minConfidence;
    }
    if (patch.maxOpenContracts !== undefined) {
      if (!Number.isInteger(patch.maxOpenContracts) || patch.maxOpenContracts < 1) {
        throw new Error('maxOpenContracts must be a positive integer');
      }
      this.settings.maxOpenContracts = patch.maxOpenContracts;
    }
    if (patch.maxSessionLossUsd !== undefined) {
      if (!Number.isFinite(patch.maxSessionLossUsd) || patch.maxSessionLossUsd <= 0) {
        throw new Error('maxSessionLossUsd must be positive');
      }
      this.settings.maxSessionLossUsd = patch.maxSessionLossUsd;
    }
    if (patch.profitTargetEnabled !== undefined) {
      this.settings.profitTargetEnabled = patch.profitTargetEnabled;
    }
    if (patch.profitTargetUsd !== undefined) {
      if (!Number.isFinite(patch.profitTargetUsd) || patch.profitTargetUsd <= 0) {
        throw new Error('profitTargetUsd must be positive');
      }
      this.settings.profitTargetUsd = patch.profitTargetUsd;
    }
    if (patch.dailyProfitLimitPercent !== undefined) {
      if (
        !Number.isFinite(patch.dailyProfitLimitPercent) ||
        patch.dailyProfitLimitPercent < 0 ||
        patch.dailyProfitLimitPercent > 100
      ) {
        throw new Error('dailyProfitLimitPercent must be between 0 and 100');
      }
      this.settings.dailyProfitLimitPercent = patch.dailyProfitLimitPercent;
    }
    if (patch.stopOnProfitTarget !== undefined) {
      this.settings.stopOnProfitTarget = patch.stopOnProfitTarget;
    }

    saveAiBinarySettings({
      mode: this.settings.mode,
      stake_usd: String(this.settings.stakeUsd),
      duration_seconds: String(this.settings.durationSeconds),
      payout_ratio: String(this.settings.payoutRatio),
      min_confidence: String(this.settings.minConfidence),
      max_open_contracts: String(this.settings.maxOpenContracts),
      max_session_loss_usd: String(this.settings.maxSessionLossUsd),
      profit_target_enabled: String(this.settings.profitTargetEnabled),
      profit_target_usd: String(this.settings.profitTargetUsd),
      daily_profit_limit_percent: String(this.settings.dailyProfitLimitPercent),
      stop_on_profit_target: String(this.settings.stopOnProfitTarget),
    });
    publishEvent('ai-binary', { action: 'SETTINGS_UPDATED', settings: this.settings });
    return this.getStatus();
  }

  /* ------------------------------- lifecycle ------------------------------- */

  start(): AiBinaryStatus {
    if (!config.AI_BINARY_ENABLED) {
      throw new Error('AI binary trading is disabled by configuration');
    }
    if (this.settings.mode === 'DISABLED') {
      throw new Error('AI binary mode is DISABLED — change the mode first');
    }
    if (!getAccount().tradingEnabled) {
      throw new Error('trading is disabled — start trading first');
    }
    if (
      this.settings.mode === 'AUTO_EXECUTE' &&
      config.MODE !== 'PAPER' &&
      !config.AI_BINARY_LIVE_AUTO_TRADING_ENABLED
    ) {
      throw new Error(
        'AI auto-execution outside PAPER mode requires AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true',
      );
    }
    if (this.running) {
      return this.getStatus();
    }

    this.running = true;
    this.stopReason = null;
    this.stats = emptyStats();
    this.currentSignal = null;
    this.lastSignalAt = null;
    this.lastTradeAt = null;
    this.lastLossAt = null;
    this.tradeTimestamps = [];
    this.warnings = [];
    this.lastRejectionReason = null;
    this.sessionId = createAiSession();
    logger.info({ mode: this.settings.mode }, 'AI binary trading started');
    publishEvent('ai-binary', { action: 'STARTED', mode: this.settings.mode });
    return this.getStatus();
  }

  stop(reason: AiStopReason = 'USER'): AiBinaryStatus {
    if (!this.running) {
      return this.getStatus();
    }
    this.running = false;
    this.stopReason = reason;
    this.persistSession(reason);
    logRiskEvent({
      type: STOP_RISK_EVENTS[reason],
      message: `AI binary trading stopped: ${reason}`,
      equityAtTrigger: getAccount().equity,
    });
    logger.info({ reason }, 'AI binary trading stopped');
    publishEvent('ai-binary', { action: 'STOPPED', reason });
    return this.getStatus();
  }


  /* ------------------------------ evaluation ------------------------------- */

  /**
   * One evaluation of the AI loop: generate, store, (maybe) trade.
   * Called by the scheduler every AI_BINARY_EVALUATION_INTERVAL_MS; never blocks.
   */
  evaluateOnce(): void {
    if (!this.running || this.settings.mode === 'DISABLED') {
      return;
    }
    const nowMs = Date.now();
    const account = getAccount();

    // Global loss limit: stop immediately.
    const floor = account.startingEquity * (1 - account.lossLimitPercent / 100);
    if (!account.tradingEnabled || (account.startingEquity > 0 && account.equity <= floor)) {
      this.warn('AI stopped: global loss limit reached');
      this.stop('LOSS_LIMIT');
      return;
    }
    if (this.stats.sessionLossUsd >= this.settings.maxSessionLossUsd) {
      this.stop('SESSION_LOSS_LIMIT');
      return;
    }
    if (this.stats.consecutiveLosses >= config.AI_BINARY_MAX_CONSECUTIVE_LOSSES) {
      this.stop('CONSECUTIVE_LOSSES');
      return;
    }
    // Profit upper limit (Phase 6.4): stop when the session profit target or
    // the daily profit limit is reached.
    if (this.profitLimitsReached()) {
      this.stop('PROFIT_TARGET');
      return;
    }
    // Binary session gain limit (Phase 6.5): applies to manual + AI combined.
    if (getBinarySessionService().isGainLimitReached()) {
      this.warn('binary session gain limit reached — AI binary stopped');
      this.stop('SESSION_GAIN_LIMIT');
      return;
    }

    // Freshness: never trade on stale data. Log the risk event only on the
    // stale → fresh transition so a dead feed does not flood the risk log.
    const latest = this.feed.getLatestTick();
    const ageMs = latest ? nowMs - new Date(latest.timestamp).getTime() : Infinity;
    if (ageMs > config.AI_BINARY_MAX_PRICE_STALE_MS) {
      this.warn(`market data stale (${Math.round(ageMs)}ms) — no trade signal`);
      if (!this.staleLogged) {
        this.staleLogged = true;
        logRiskEvent({
          type: 'AI_BINARY_MARKET_DATA_STALE',
          message: `AI binary blocked: latest price is ${Math.round(ageMs)}ms old`,
          equityAtTrigger: account.equity,
        });
      }
      return;
    }
    this.staleLogged = false;

    // Generate + always store the signal.
    const result = generateAiSignal(
      this.feed.getRecentTicks(100),
      nowMs,
      config.AI_BINARY_MAX_PRICE_STALE_MS,
    );
    const decision = createAiBinaryDecision({
      asset: config.AI_BINARY_ASSET,
      signal: result.signal,
      confidence: result.confidence,
      reason: result.reason,
      featuresJson: JSON.stringify(result.features),
      mode: this.settings.mode,
      marketPrice: latest?.price ?? 0,
    });
    this.stats.totalSignals += 1;
    this.lastSignalAt = result.timestamp;
    const previousSignal = this.currentSignal?.signal ?? null;
    this.currentSignal = {
      signal: result.signal,
      confidence: result.confidence,
      reason: result.reason,
      at: result.timestamp,
    };
    this.clearWarningsMatching(/^market data stale/);
    publishEvent('ai-binary', { action: 'SIGNAL', decision });

    // Risk-event the signal generation on transitions (avoids flooding the log).
    if (result.signal !== 'NEUTRAL' && result.signal !== previousSignal) {
      logRiskEvent({
        type: 'AI_BINARY_SIGNAL_GENERATED',
        message: `AI signal ${result.signal} (confidence ${(result.confidence * 100).toFixed(0)}%): ${result.reason}`,
        equityAtTrigger: account.equity,
      });
    }

    if (this.settings.mode !== 'AUTO_EXECUTE' || result.signal === 'NEUTRAL') {
      return;
    }

    // Safety gate: never auto-execute outside PAPER mode unless explicitly
    // enabled. (start()/updateSettings() enforce this too — belt and braces.)
    if (config.MODE !== 'PAPER' && !config.AI_BINARY_LIVE_AUTO_TRADING_ENABLED) {
      this.warn('live AI auto-execution is disabled by configuration');
      return;
    }

    // ------------ AUTO_EXECUTE risk checks ------------
    const reject = (reason: string): void => {
      updateAiBinaryDecisionRejection(decision.id, reason);
      if (reason !== this.lastRejectionReason) {
        this.lastRejectionReason = reason;
        logRiskEvent({
          type: 'AI_BINARY_TRADE_REJECTED',
          message: `AI binary trade rejected: ${reason}`,
          equityAtTrigger: account.equity,
        });
      }
      this.warn(reason);
    };

    if (result.confidence < this.settings.minConfidence) {
      reject(`confidence ${(result.confidence * 100).toFixed(0)}% below minimum`);
      return;
    }
    const required = config.AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS;
    const recent = recentAiSignals(required);
    if (recent.length < required || !recent.every((row) => row.signal === result.signal)) {
      reject(`signal persistence ${recent.length}/${required} ticks`);
      return;
    }
    if (
      this.lastTradeAt !== null &&
      nowMs - this.lastTradeAt < config.AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS
    ) {
      reject('minimum time between trades not elapsed');
      return;
    }
    if (
      this.lastLossAt !== null &&
      nowMs - this.lastLossAt < config.AI_BINARY_COOLDOWN_AFTER_LOSS_MS
    ) {
      reject('cooldown after loss');
      return;
    }
    if (countOpenBinaryContracts('AI_BINARY') >= this.settings.maxOpenContracts) {
      reject('maximum open AI contracts reached');
      return;
    }



    const hourAgo = nowMs - 3_600_000;
    this.tradeTimestamps = this.tradeTimestamps.filter((t) => t >= hourAgo);
    if (this.tradeTimestamps.length >= config.AI_BINARY_MAX_TRADES_PER_HOUR) {
      reject('maximum trades per hour reached');
      logRiskEvent({
        type: 'AI_BINARY_MAX_TRADES_PER_HOUR_REACHED',
        message: `AI binary blocked: ${config.AI_BINARY_MAX_TRADES_PER_HOUR} trades/hour reached`,
        equityAtTrigger: account.equity,
      });
      return;
    }
    if (account.cashBalance < this.settings.stakeUsd) {
      reject(
        `insufficient balance (${account.cashBalance.toFixed(2)} < ${this.settings.stakeUsd})`,
      );
      return;
    }

    this.lastRejectionReason = null;
    try {
      const contract = this.binary.openBinaryContract({
        asset: config.AI_BINARY_ASSET,
        direction: result.signal,
        stakeUsd: this.settings.stakeUsd,
        durationSeconds: this.settings.durationSeconds,
        payoutRatio: this.settings.payoutRatio,
        source: 'AI_BINARY',
      });
      updateAiBinaryDecisionExecution(decision.id, contract.id);
      this.stats.totalTrades += 1;
      this.tradeTimestamps.push(nowMs);
      this.lastTradeAt = nowMs;
      this.persistSession(null);
      logRiskEvent({
        type: 'AI_BINARY_TRADE_EXECUTED',
        message: `AI binary ${contract.direction} ${this.settings.durationSeconds}s #${contract.id} stake ${this.settings.stakeUsd}`,
        equityAtTrigger: account.equity,
      });
      logger.info(
        { contractId: contract.id, direction: contract.direction },
        'AI binary trade opened',
      );
      publishEvent('ai-binary', { action: 'TRADE_OPENED', contract, decisionId: decision.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'open failed';
      reject(`open failed: ${message}`);
    }
  }

  /* ------------------------------ settlements ------------------------------ */

  private handleAiSettled(contract: BinaryContract): void {
    if (contract.result === 'WIN') {
      this.stats.wins += 1;
      this.stats.netPnl += contract.potentialProfitUsd;
      this.stats.consecutiveLosses = 0;
    } else if (contract.result === 'LOSE') {
      this.stats.losses += 1;
      this.stats.netPnl -= contract.stakeUsd;
      this.stats.consecutiveLosses += 1;
      this.lastLossAt = Date.now();
    } else {
      this.stats.refunds += 1;
    }
    this.stats.sessionLossUsd = Math.max(0, -this.stats.netPnl);
    this.persistSession(null);
    publishEvent('ai-binary', { action: 'TRADE_SETTLED', contract });

    if (this.running) {
      if (this.stats.consecutiveLosses >= config.AI_BINARY_MAX_CONSECUTIVE_LOSSES) {
        this.stop('CONSECUTIVE_LOSSES');
      } else if (this.stats.sessionLossUsd >= this.settings.maxSessionLossUsd) {
        this.stop('SESSION_LOSS_LIMIT');
      } else if (this.profitLimitsReached()) {
        this.stop('PROFIT_TARGET');
      } else if (getBinarySessionService().isGainLimitReached()) {
        this.stop('SESSION_GAIN_LIMIT');
      }
    }
  }

  /**
   * Refreshes the profit display stats and reports whether the profit upper
   * limit is reached (session target or daily limit). Records the trigger
   * once and stops auto-execution when stopOnProfitTarget is enabled.
   */
  private profitLimitsReached(): boolean {
    const sessionProfit = Math.max(0, this.stats.netPnl);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dailyProfit = getAiBinaryProfitSince(dayStart.toISOString());
    const account = getAccount();
    const dailyLimitUsd =
      account.startingEquity > 0
        ? account.startingEquity * (this.settings.dailyProfitLimitPercent / 100)
        : 0;

    this.stats.sessionProfitUsd = sessionProfit;
    this.stats.dailyProfitUsd = dailyProfit;
    this.stats.profitTargetUsd = this.settings.profitTargetUsd;
    this.stats.dailyProfitLimitPercent = this.settings.dailyProfitLimitPercent;
    this.stats.remainingProfitUntilTarget = Math.max(
      0,
      this.settings.profitTargetUsd - sessionProfit,
    );

    if (!this.settings.profitTargetEnabled) {
      return false;
    }
    const sessionTargetHit = sessionProfit >= this.settings.profitTargetUsd;
    const dailyLimitHit = dailyLimitUsd > 0 && dailyProfit >= dailyLimitUsd;
    if (!sessionTargetHit && !dailyLimitHit) {
      return false;
    }
    if (!this.stats.profitTargetReachedAt) {
      this.stats.profitTargetReachedAt = new Date().toISOString();
      this.stats.stoppedByProfitTarget = true;
      logRiskEvent({
        type: sessionTargetHit
          ? 'AI_BINARY_PROFIT_TARGET_REACHED'
          : 'AI_BINARY_DAILY_PROFIT_LIMIT_REACHED',
        message: sessionTargetHit
          ? `AI session profit ${sessionProfit.toFixed(2)} reached the ${this.settings.profitTargetUsd} USDC target`
          : `AI daily profit ${dailyProfit.toFixed(2)} reached ${this.settings.dailyProfitLimitPercent}% of starting equity`,
        equityAtTrigger: account.equity,
      });
      publishEvent('ai-binary', {
        action: 'PROFIT_TARGET_REACHED',
        sessionProfitUsd: sessionProfit,
        dailyProfitUsd: dailyProfit,
        dailyLimitHit,
      });
      this.persistSession(null);
    }
    return this.settings.stopOnProfitTarget;
  }

  /* ------------------------------- helpers --------------------------------- */

  private persistSession(stopReason: AiStopReason | null): void {
    if (this.sessionId === null) {
      return;
    }
    updateAiSession(this.sessionId, {
      ...this.stats,
      profitTargetUsd: this.stats.profitTargetUsd,
      dailyProfitLimitPercent: this.stats.dailyProfitLimitPercent,
      stoppedByProfitTarget: this.stats.stoppedByProfitTarget,
    }, stopReason);
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  private clearWarningsMatching(pattern: RegExp): void {
    this.warnings = this.warnings.filter((warning) => !pattern.test(warning));
  }

  getDecisions(limit = 50): AiBinaryDecision[] {
    return listAiBinaryDecisions(limit);
  }

  getStatus(): AiBinaryStatus {
    const openContracts = countOpenBinaryContracts('AI_BINARY');
    const warnings = [...this.warnings];
    if (this.stopReason !== null && !this.running) {
      warnings.unshift(`stopped: ${this.stopReason.replaceAll('_', ' ').toLowerCase()}`);
    }
    if (
      this.settings.mode === 'AUTO_EXECUTE' &&
      config.MODE !== 'PAPER' &&
      !config.AI_BINARY_LIVE_AUTO_TRADING_ENABLED
    ) {
      warnings.unshift('live AI auto-execution is disabled by configuration');
    }
    return {
      enabled: config.AI_BINARY_ENABLED,
      mode: this.settings.mode,
      running: this.running,
      currentSignal: this.currentSignal?.signal ?? null,
      confidence: this.currentSignal?.confidence ?? 0.5,
      reason: this.currentSignal?.reason ?? null,
      stakeUsd: this.settings.stakeUsd,
      durationSeconds: this.settings.durationSeconds,
      payoutRatio: this.settings.payoutRatio,
      minConfidence: this.settings.minConfidence,
      maxOpenContracts: this.settings.maxOpenContracts,
      maxSessionLossUsd: this.settings.maxSessionLossUsd,
      lastSignalAt: this.lastSignalAt,
      lastTradeAt: this.lastTradeAt !== null ? new Date(this.lastTradeAt).toISOString() : null,
      openContracts,
      sessionStats: { ...this.stats },
      warnings: warnings.slice(0, 6),
      profitTargetEnabled: this.settings.profitTargetEnabled,
      profitTargetUsd: this.settings.profitTargetUsd,
      sessionProfitUsd: this.stats.sessionProfitUsd,
      dailyProfitUsd: this.stats.dailyProfitUsd,
      stoppedByProfitTarget: this.stats.stoppedByProfitTarget,
    };
  }
}


/* ------------------------------- singleton -------------------------------- */

let sharedService: AiBinaryService | null = null;

/** Lazily creates the shared AI binary service (requires DB init first). */
export function getAiBinaryService(): AiBinaryService {
  if (!sharedService) {
    sharedService = new AiBinaryService(liveMarket, binaryService);
  }
  return sharedService;
}
