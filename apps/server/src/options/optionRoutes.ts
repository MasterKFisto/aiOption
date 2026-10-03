import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { CLASSIC_ERRORS, ClassicOptionError, optionService } from './optionService.js';
import type { OptionService } from './optionService.js';

// Duration is REQUIRED (no coercion of missing values to a default); its
// allowed set and 60-minute cap are enforced by OptionService.validateDuration.
const openSchema = z.object({
  asset: z.literal('BTC/USDT').default('BTC/USDT'),
  side: z.enum(['CALL', 'PUT']),
  stakeUsd: z.number().finite().positive(),
  durationSeconds: z.number(),
});

/**
 * Classic short-duration option endpoints. Registered with prefix /api.
 * The service is injectable via options for tests.
 */
export async function optionRoutes(
  app: FastifyInstance,
  options: { service?: OptionService } = {},
): Promise<void> {
  const service = options.service ?? optionService;

  app.get('/options/config', async () => service.getConfig());

  app.post('/options/open', async (request, reply) => {
    const parsed = openSchema.safeParse(request.body);
    if (!parsed.success) {
      const durationIssue = parsed.error.issues.some((issue) => issue.path[0] === 'durationSeconds');
      return reply.code(400).send({
        error: durationIssue ? CLASSIC_ERRORS.invalidDuration : 'invalid request body',
        issues: parsed.error.issues,
      });
    }
    try {
      const position = service.openOption({
        asset: parsed.data.asset,
        side: parsed.data.side,
        stakeUsd: parsed.data.stakeUsd,
        durationSeconds: parsed.data.durationSeconds,
      });
      return reply.code(201).send(position);
    } catch (err) {
      if (err instanceof ClassicOptionError) {
        return reply.code(400).send({ error: err.message, code: err.code });
      }
      request.log.error({ err }, 'classic open failed');
      return reply.code(500).send({ error: 'open failed' });
    }
  });
}
