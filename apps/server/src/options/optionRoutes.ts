import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { optionService } from './optionService.js';
import type { OptionService } from './optionService.js';

const openSchema = z.object({
  asset: z.string().trim().min(1).default('BTC/USDC'),
  side: z.enum(['CALL', 'PUT']),
  stakeUsd: z.coerce.number().positive(),
  durationSeconds: z.coerce.number().int().positive(),
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
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
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
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'open failed' });
    }
  });
}
