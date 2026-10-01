import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountUpdate } from '@aioption/shared';

import { getAccount, updateAccount } from '../db/repositories.js';
import { tradingLoop } from '../scheduler/tradingLoop.js';

const riskSettingsSchema = z.object({
  maxOpenPositions: z.coerce.number().int().min(1).max(100).optional(),
  lossLimitPercent: z.coerce.number().min(0).max(100).optional(),
  fixedTradeSizeUsd: z.coerce.number().positive().optional(),
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
    };
    const account = updateAccount(patch);
    return {
      maxOpenPositions: account.maxOpenPositions,
      lossLimitPercent: account.lossLimitPercent,
      fixedTradeSizeUsd: account.fixedTradeSizeUsd,
    };
  });
}
