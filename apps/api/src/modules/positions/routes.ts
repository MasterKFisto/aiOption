import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { positionService } from './service.js';

export async function positionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const positions = await positionService.getAllPositions(req.userId!);
    reply.send(positions);
  });

  app.get('/open', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const positions = await positionService.getOpenPositions(req.userId!);
    reply.send(positions);
  });
}