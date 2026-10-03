import type { OptionSide } from '@aioption/shared';

import {
  getAccount,
  markAiDecisionExecuted,
  recordAiDecisionRejection,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { logger } from '../logger.js';
import { ClassicMarketData } from '../market/classicMarketData.js';
import { getClassicSettingsStore } from '../options/classicSettings.js';
import { optionService } from '../options/optionService.js';
import type { OptionService } from '../options/optionService.js';
import { RiskEngine } from '../risk/riskEngine.js';
import type { MarketDataProvider } from '../strategy/signalEngine.js';
import { directionGuard } from '../strategy/directionGuard.js';
import type { DirectionGuard } from '../strategy/directionGuard.js';
import { SignalEngine } from '../strategy/signalEngine.js';
import { WalletService } from '../services/walletService.js';

export interface TradingLoopOptions {
  intervalMs?: number;
  market?: MarketDataProvider;
  engine?: SignalEngine;
  risk?: RiskEngine;
  wallet?: WalletService;
  /** Classic option service used to open AI positions (injectable for tests). */
  options?: OptionService;
  /** Direction streak / flip guard (injectable for tests). */
  guard?: DirectionGuard;
}

export interface LoopExecution {
  symbol: string;
  decisionId: number;
  positionId: number;
}

export interface LoopRunResult {
  symbols: string[];
  executed: LoopExecution[];
  skipped: Array<{ symbol: string; reason: string }>;
  /** True when the loss limit fired and trading was halted during this run. */
  halted: boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;

const isBtc = (symbol: string): boolean => (symbol.split('/')[0] ?? '').toUpperCase() === 'BTC';

/**
 * The main scheduler: every `intervalMs` (default 1 minute) it fetches market
 * data, generates an AI signal per symbol, runs it through the risk engine,
 * executes approved trades via the paper adapter, and updates the wallet and
 * positions.
 */
export class TradingLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;

  private readonly intervalMs: number;
  private readonly market: MarketDataProvider;
  private readonly engine: SignalEngine;
  private readonly risk: RiskEngine;
  private readonly wallet: WalletService;
  private readonly options: OptionService;
  private readonly guard: DirectionGuard;

  constructor(options: TradingLoopOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Default: real BTC candles (same feed that settles the options), with
    // the mean-reverting simulator as fallback when the live feed is down.
    this.market = options.market ?? new ClassicMarketData();
    this.wallet = options.wallet ?? new WalletService();
    this.guard = options.guard ?? directionGuard;
    this.engine = options.engine ?? new SignalEngine(this.market, { guard: this.guard });
    this.options = options.options ?? optionService;
    this.risk = options.risk ?? new RiskEngine(this.wallet, this.options, this.guard);
  }

  /** Direction streak state (for the Classic status panel). */
  get directionState() {
    return this.guard.state();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Starts the scheduler (does not run immediately — first tick after intervalMs). */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    logger.info({ intervalMs: this.intervalMs }, 'trading loop started');
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('trading loop stopped');
  }

  /** One scheduler tick. Exposed for tests and manual runs. */
  async runOnce(): Promise<LoopRunResult> {
    const result: LoopRunResult = {
      symbols: this.market.getSymbols(),
      executed: [],
      skipped: [],
      halted: false,
    };
    // Never run two ticks concurrently (live candle fetch is async).
    if (this.ticking) {
      result.skipped.push({ symbol: '*', reason: 'previous tick still running' });
      return result;
    }
    this.ticking = true;

    try {
      // 1. Loss-limit gate (also disables trading + closes positions on trigger).
      if (this.risk.checkLossLimit().triggered) {
        result.halted = true;
        this.stop();
        return result;
      }

      // 2. Only trade while the master switch AND the classic flag are on.
      if (!getAccount().tradingEnabled || !getClassicSettingsStore().classicFlag()) {
        return result;
      }

      // 3a. Refresh market data (live BTC candles) before evaluating.
      await this.market.prepare?.();

      // 3. Signal -> risk -> execute per symbol.
      for (const symbol of result.symbols) {
        // Phase 6.5.1: classic options settle against the BTC/USDC live feed
        // only — never evaluate/open other underlyings (e.g. ETH) that would
        // be settled against the wrong price (and would pollute the
        // direction streak of the AI).
        if (!isBtc(symbol)) {
          result.skipped.push({ symbol, reason: 'classic options trade BTC/USDC only' });
          continue;
        }

        const decision = this.engine.evaluate(symbol);
        const verdict = this.risk.evaluate(decision);
        if (!verdict.approved) {
          const reason = verdict.reason ?? 'rejected by risk engine';
          result.skipped.push({ symbol, reason });
          // Phase 6.5.2: store WHY on the decision (shown in the UI). Neutral
          // signals already carry their strategy filter reason.
          if (decision.signal !== 'NEUTRAL') {
            recordAiDecisionRejection(decision.id, reason);
          }
          logger.info({ symbol, reason }, 'trade skipped');
          continue;
        }

        try {
          const side: OptionSide = decision.action === 'OPEN_CALL' ? 'CALL' : 'PUT';
          // Opens through the shared OptionService so the AI path locks
          // EXACTLY the stake (no fee drift), gets the fixed default duration
          // and an explicit expiry, and is settled by the 1s scheduler.
          const position = this.options.openOption({
            asset: 'BTC/USDC',
            side,
            stakeUsd: decision.proposedTradeSizeUsd,
            durationSeconds: getClassicSettingsStore().defaultDurationSeconds(),
            source: 'AI',
          });
          markAiDecisionExecuted(decision.id, position.id);
          this.guard.recordExecution(side);
          publishEvent('trade', { action: 'OPENED', position });

          result.executed.push({ symbol, decisionId: decision.id, positionId: position.id });
          logger.info({ symbol, positionId: position.id }, 'AI classic option executed');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.skipped.push({ symbol, reason: message });
          recordAiDecisionRejection(decision.id, message);
          logger.error({ symbol, err }, 'execution failed');
        }
      }
    } catch (err) {
      logger.error({ err }, 'trading loop tick failed');
    } finally {
      this.ticking = false;
    }

    return result;
  }
}

// The singleton used by the Fastify app and the trading routes.
export const tradingLoop = new TradingLoop();
