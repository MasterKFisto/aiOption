import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getAiBinaryService } from '../binary-ai/binaryAiService.js';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { publishEvent } from '../events/eventBus.js';
import { logger } from '../logger.js';
import { tradingLoop } from '../scheduler/tradingLoop.js';
import { runUatReset, UatResetError, verifyUatReset } from './uatReset.js';

const resetSchema = z
  .object({
    confirm: z.literal('YES'),
    startingBalanceUsdc: z.coerce.number().min(0).max(1_000_000).default(0),
    allowLive: z.boolean().default(false),
  })
  .strict();

/**
 * Admin / maintenance endpoints (Phase 7). DISABLED by default: unless
 * ENABLE_ADMIN_API=true every route answers 404 (indistinguishable from a
 * missing route). The CLI reset (`pnpm --filter server reset:uat`) is the
 * recommended path; this API exists only for controlled UAT sessions.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    if (!config.ENABLE_ADMIN_API) {
      return reply.code(404).send({ error: 'not found' });
    }
    request.log.warn({ url: request.url, method: request.method }, 'admin API call');
    return undefined;
  });

  app.get('/admin/uat-verify', async () => verifyUatReset(getDb()));

  app.post('/admin/uat-reset', async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body must be {"confirm":"YES","startingBalanceUsdc":<number>}',
        issues: parsed.error.issues,
      });
    }
    try {
      // Stop the background traders first so nothing writes mid-reset.
      tradingLoop.stop();
      getAiBinaryService().stop('USER');
      const result = runUatReset(getDb(), {
        mode: config.MODE,
        confirm: parsed.data.confirm,
        allowLive: parsed.data.allowLive && process.env['UAT_RESET_ALLOW_LIVE'] === 'true' ? 'true' : undefined,
        startingBalanceUsdc: parsed.data.startingBalanceUsdc,
        defaults: {
          baseCurrency: config.BASE_CURRENCY,
          fixedTradeSizeUsd: config.FIXED_TRADE_SIZE_USD,
          lossLimitPercent: config.LOSS_LIMIT_PERCENT,
          maxOptionStakeUsd: config.MAX_OPTION_STAKE_USD,
          optionDefaultDurationSeconds: config.OPTION_DEFAULT_DURATION_SECONDS,
        },
      });
      logger.warn({ cleared: result.clearedRows }, 'UAT reset performed via admin API');
      publishEvent('account', { action: 'UAT_RESET' });
      return {
        ...result,
        verification: verifyUatReset(getDb(), result.startingBalanceUsdc),
        note: 'restart the server so in-memory session state starts clean',
      };
    } catch (err) {
      if (err instanceof UatResetError) {
        return reply.code(err.code === 'LIVE_MODE_BLOCKED' ? 403 : 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
}
