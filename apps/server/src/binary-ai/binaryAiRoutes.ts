import type { AiBinarySettingsUpdate } from '@aioption/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import { getAiBinaryService } from './binaryAiService.js';
import type { AiBinaryService } from './binaryAiService.js';

const settingsSchema = z.object({
  mode: z.enum(['DISABLED', 'SIGNAL_ONLY', 'AUTO_EXECUTE']).optional(),
  stakeUsd: z.coerce.number().positive().optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
  payoutRatio: z.coerce.number().positive().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxOpenContracts: z.coerce.number().int().min(1).optional(),
  maxSessionLossUsd: z.coerce.number().positive().optional(),
  profitTargetEnabled: z.boolean().optional(),
  profitTargetUsd: z.coerce.number().positive().optional(),
  dailyProfitLimitPercent: z.coerce.number().min(0).max(100).optional(),
  stopOnProfitTarget: z.boolean().optional(),
});

/**
 * AI binary trading endpoints, registered under /api/binary-ai.
 * The service is injectable via options for tests.
 */
export async function binaryAiRoutes(
  app: FastifyInstance,
  options: { service?: AiBinaryService } = {},
): Promise<void> {
  const service = options.service ?? getAiBinaryService();

  app.get('/binary-ai/status', async () => service.getStatus());

  app.put('/binary-ai/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid settings', issues: parsed.error.issues });
    }
    try {
      const patch: AiBinarySettingsUpdate = {};
      if (parsed.data.mode !== undefined) patch.mode = parsed.data.mode;
      if (parsed.data.stakeUsd !== undefined) patch.stakeUsd = parsed.data.stakeUsd;
      if (parsed.data.durationSeconds !== undefined) {
        patch.durationSeconds = parsed.data.durationSeconds;
      }
      if (parsed.data.payoutRatio !== undefined) patch.payoutRatio = parsed.data.payoutRatio;
      if (parsed.data.minConfidence !== undefined) {
        patch.minConfidence = parsed.data.minConfidence;
      }
      if (parsed.data.maxOpenContracts !== undefined) {
        patch.maxOpenContracts = parsed.data.maxOpenContracts;
      }
      if (parsed.data.maxSessionLossUsd !== undefined) {
        patch.maxSessionLossUsd = parsed.data.maxSessionLossUsd;
      }
      if (parsed.data.profitTargetEnabled !== undefined) {
        patch.profitTargetEnabled = parsed.data.profitTargetEnabled;
      }
      if (parsed.data.profitTargetUsd !== undefined) {
        patch.profitTargetUsd = parsed.data.profitTargetUsd;
      }
      if (parsed.data.dailyProfitLimitPercent !== undefined) {
        patch.dailyProfitLimitPercent = parsed.data.dailyProfitLimitPercent;
      }
      if (parsed.data.stopOnProfitTarget !== undefined) {
        patch.stopOnProfitTarget = parsed.data.stopOnProfitTarget;
      }
      return service.updateSettings(patch);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'invalid settings' });
    }
  });

  app.post('/binary-ai/start', async (_request, reply) => {
    try {
      return service.start();
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'start failed' });
    }
  });

  app.post('/binary-ai/stop', async () => service.stop('USER'));

  app.get('/binary-ai/decisions', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    return service.getDecisions(limit);
  });

  app.get('/binary-ai/stats', async () => {
    const status = service.getStatus();
    return {
      enabled: config.AI_BINARY_ENABLED,
      running: status.running,
      sessionStats: status.sessionStats,
      stopReason: status.warnings.find((warning) => warning.startsWith('stopped:')) ?? null,
    };
  });
}
