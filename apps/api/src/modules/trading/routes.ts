import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { tradingSettingsService } from './service.js';
import { updateTradingSettingsSchema } from '@ai-options/shared';

export async function tradingRoutes(app: FastifyInstance): Promise<void> {
  // GET /trading/settings
  app.get('/settings', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const settings = await tradingSettingsService.getSettings(req.userId!);
    reply.send(settings);
  });

  // PUT /trading/settings
  app.put('/settings', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = updateTradingSettingsSchema.parse(req.body);
    const settings = await tradingSettingsService.updateSettings(req.userId!, body);
    reply.send(settings);
  });
}