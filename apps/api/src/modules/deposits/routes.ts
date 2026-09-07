import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { depositService } from './service.js';
import { simulateDepositSchema } from '@ai-options/shared';

export async function depositRoutes(app: FastifyInstance): Promise<void> {
  app.post('/simulate', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = simulateDepositSchema.parse(req.body);
    const deposit = await depositService.simulateDeposit(req.userId!, body.asset, body.amount);
    reply.status(201).send(deposit);
  });

  app.get('/', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const deposits = await depositService.getDeposits(req.userId!);
    reply.send(deposits);
  });
}