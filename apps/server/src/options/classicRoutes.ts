import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { roundMoney } from '@aioption/shared';
import type { ClassicStatus } from '@aioption/shared';

import {
  getAccount,
  listRecentClosedPositions,
  positionStake,
  updateAccount,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { tradingLoop } from '../scheduler/tradingLoop.js';
import type { TradingLoop } from '../scheduler/tradingLoop.js';
import {
  StrategySettingsError,
  getStrategySettings,
  updateStrategySettings,
} from '../strategy/classicStrategySettings.js';
import { ClassicSettingsError, getClassicSettingsStore } from './classicSettings.js';
import { optionService } from './optionService.js';
import type { OptionService } from './optionService.js';

const settingsSchema = z
  .object({
    defaultStakeUsd: z.number().finite().positive().optional(),
    maxStakeUsd: z.number().finite().positive().optional(),
    defaultDurationSeconds: z.number().int().positive().optional(),
    dailyLossLimitPercent: z.number().finite().optional(),
    totalLossLimitPercent: z.number().finite().optional(),
  })
  .strict();

const strategySchema = z
  .object({
    rsiPeriod: z.number().int().optional(),
    rsiOverbought: z.number().finite().optional(),
    rsiOversold: z.number().finite().optional(),
    requireNeutralCooldown: z.boolean().optional(),
    maxConsecutiveSameDirection: z.number().int().optional(),
    cooldownAfterMaxConsecutiveMs: z.number().int().optional(),
  })
  .strict();

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

/**
 * Classic Options control + settings (Phase 6.5.1). Registered with prefix /api.
 *
 *   GET  /api/classic/settings     PUT /api/classic/settings
 *   POST /api/classic/trading/start   POST /api/classic/trading/stop
 *   GET  /api/classic/status       GET /api/classic/history?limit=N
 *   POST /api/classic/repair-locked-balance
 */
export async function classicRoutes(
  app: FastifyInstance,
  options: { service?: OptionService; loop?: TradingLoop } = {},
): Promise<void> {
  const service = options.service ?? optionService;
  const loop = options.loop ?? tradingLoop;
  const store = getClassicSettingsStore();

  const buildStatus = (): ClassicStatus => {
    const account = getAccount();
    const enabled = store.isTradingEnabled();
    const marketDataFresh = service.isMarketDataFresh();
    const lossState = store.lossLimitState();
    let blockedReason: ClassicStatus['blockedReason'] = null;
    let blockedMessage: string | null = null;
    if (!enabled) {
      blockedReason = 'TRADING_DISABLED';
      blockedMessage = 'Classic Options trading is disabled.';
    } else if (lossState) {
      blockedReason = lossState.reason;
      blockedMessage = lossState.message;
    } else if (!marketDataFresh) {
      blockedReason = 'MARKET_DATA_STALE';
      blockedMessage = 'Market data is stale — new options are paused until prices resume.';
    } else if (account.cashBalance < store.getSettings().minStakeUsd) {
      blockedReason = 'RISK_ENGINE_BLOCKED';
      blockedMessage = 'Available balance is below the minimum stake.';
    }
    return {
      tradingEnabled: enabled,
      loopRunning: loop.isRunning,
      blockedReason,
      blockedMessage,
      openPositions: store.getSettings().openPositionCount,
      lockedBalance: roundMoney(account.lockedBalance),
      openClassicStakeUsd: store.openClassicStakeUsd(),
      availableBalance: roundMoney(account.cashBalance),
      marketDataFresh,
      lastUpdated: new Date().toISOString(),
    };
  };

  app.get('/classic/settings', async () => store.getSettings());

  app.put('/classic/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    try {
      const update = Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      );
      return store.updateSettings(update);
    } catch (err) {
      if (err instanceof ClassicSettingsError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post('/classic/trading/start', async (_request, reply) => {
    const account = getAccount();
    if (account.equity <= 0) {
      return reply.code(400).send({ error: 'Deposit funds before starting Classic Options trading.' });
    }
    const lossState = store.lossLimitState();
    if (lossState) {
      return reply.code(400).send({ error: lossState.message, blockedReason: lossState.reason });
    }
    // Same semantics as /api/trading/start: enable the master switch,
    // snapshot the loss-limit baseline once, and run the classic AI loop.
    const startingEquity = account.startingEquity > 0 ? account.startingEquity : account.equity;
    updateAccount({ tradingEnabled: true, startingEquity });
    store.setClassicFlag(true);
    loop.start();
    publishEvent('classic', { action: 'STARTED' });
    publishEvent('account', getAccount());
    return buildStatus();
  });

  // Stops NEW classic options only. Open positions keep settling at expiry;
  // Binary trading (master switch) is left untouched.
  app.post('/classic/trading/stop', async () => {
    store.setClassicFlag(false);
    loop.stop();
    publishEvent('classic', { action: 'STOPPED' });
    return buildStatus();
  });

  app.get('/classic/status', async () => buildStatus());

  app.get('/classic/history', async (request, reply) => {
    const parsed = historyQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    return listRecentClosedPositions(parsed.data.limit).map((position) => ({
      ...position,
      stakeUsd: positionStake(position),
    }));
  });

  app.post('/classic/repair-locked-balance', async () => service.repairLockedBalance());

  /* ---------------------- Phase 6.5.2: AI strategy ---------------------- */

  // Applied to the live loop immediately: settings are read on every evaluation.
  app.get('/classic/strategy', async () => ({
    settings: getStrategySettings(),
    direction: loop.directionState,
  }));

  app.put('/classic/strategy', async (request, reply) => {
    const parsed = strategySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    try {
      const update = Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      );
      return { settings: updateStrategySettings(update), direction: loop.directionState };
    } catch (err) {
      if (err instanceof StrategySettingsError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
