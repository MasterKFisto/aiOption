import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountUpdate } from '@aioption/shared';

import { config } from '../config.js';
import { getAccount, updateAccount } from '../db/repositories.js';
import { tradingLoop } from '../scheduler/tradingLoop.js';

const riskSettingsSchema = z.object({
  // 0 = unlimited (no cap on the number of open trades).
  maxOpenPositions: z.coerce.number().int().min(0).max(1000).optional(),
  // Daily loss limit: safe maximum of 80% unless configured otherwise.
  lossLimitPercent: z.coerce.number().min(0).max(80).optional(),
  fixedTradeSizeUsd: z.coerce.number().positive().optional(),
  postTradePromptEnabled: z.coerce.boolean().optional(),
  maxOptionStakeUsd: z.coerce.number().min(1).max(100).optional(),
  // Phase 6.5.1: must be one of the fixed allowed durations (max 60 minutes).
  optionDefaultDurationSeconds: z.coerce
    .number()
    .int()
    .refine((value) => config.OPTION_ALLOWED_DURATIONS_SECONDS.includes(value), {
      message: 'Invalid option duration.',
    })
    .optional(),
});

/**
 * Trading loop control + risk settings.
 *
 * Registered with prefix /api/trading:
 *   GET  /api/trading/status
 *   POST /api/trading/start
 *   POST /api/trading/stop
 *   PUT  /api/trading/risk/settings   { maxOpenPositions?, lossLimitPercent?, fixedTradeSizeUsd? }
 */
export async function tradingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async () => {
    const account = getAccount();
    return {
      running: tradingLoop.isRunning,
      account: {
        tradingEnabled: account.tradingEnabled,
        startingEquity: account.startingEquity,
        equity: account.equity,
        cashBalance: account.cashBalance,
        lockedBalance: account.lockedBalance,
        maxOpenPositions: account.maxOpenPositions,
        lossLimitPercent: account.lossLimitPercent,
        fixedTradeSizeUsd: account.fixedTradeSizeUsd,
      },
    };
  });

  app.post('/start', async (_request, reply) => {
    const account = getAccount();
    if (account.equity <= 0) {
      return reply.code(400).send({ error: 'Deposit paper funds before enabling trading' });
    }
    // Snapshot the loss-limit baseline the first time trading is enabled.
    const startingEquity = account.startingEquity > 0 ? account.startingEquity : account.equity;
    updateAccount({ tradingEnabled: true, startingEquity });
    tradingLoop.start();
    return { running: true, startingEquity };
  });

  app.post('/stop', async () => {
    updateAccount({ tradingEnabled: false });
    tradingLoop.stop();
    return { running: false };
  });

  app.put('/risk/settings', async (request, reply) => {
    const parsed = riskSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    // Strip undefined keys so the patch satisfies AccountUpdate under
    // exactOptionalPropertyTypes.
    const patch: AccountUpdate = {
      ...(parsed.data.maxOpenPositions !== undefined
        ? { maxOpenPositions: parsed.data.maxOpenPositions }
        : {}),
      ...(parsed.data.lossLimitPercent !== undefined
        ? { lossLimitPercent: parsed.data.lossLimitPercent }
        : {}),
      ...(parsed.data.fixedTradeSizeUsd !== undefined
        ? { fixedTradeSizeUsd: parsed.data.fixedTradeSizeUsd }
        : {}),
      ...(parsed.data.postTradePromptEnabled !== undefined
        ? { postTradePromptEnabled: parsed.data.postTradePromptEnabled }
        : {}),
      ...(parsed.data.maxOptionStakeUsd !== undefined
        ? { maxOptionStakeUsd: parsed.data.maxOptionStakeUsd }
        : {}),
      ...(parsed.data.optionDefaultDurationSeconds !== undefined
        ? { optionDefaultDurationSeconds: parsed.data.optionDefaultDurationSeconds }
        : {}),
    };
    const account = updateAccount(patch);
    return {
      maxOpenPositions: account.maxOpenPositions,
      lossLimitPercent: account.lossLimitPercent,
      fixedTradeSizeUsd: account.fixedTradeSizeUsd,
      postTradePromptEnabled: account.postTradePromptEnabled,
      maxOptionStakeUsd: account.maxOptionStakeUsd,
      optionDefaultDurationSeconds: account.optionDefaultDurationSeconds,
    };
  });
}
