import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { withdrawalService } from './service.js';
import { requestWithdrawalSchema } from '@ai-options/shared';

export async function withdrawalRoutes(app: FastifyInstance): Promise<void> {
  // POST /withdrawals
  app.post('/', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = requestWithdrawalSchema.parse(req.body);
    const withdrawal = await withdrawalService.requestWithdrawal(
      req.userId!, body.asset, body.amount, body.destinationAddress,
    );
    reply.status(201).send(withdrawal);
  });

  // GET /withdrawals
  app.get('/', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const withdrawals = await withdrawalService.getWithdrawals(req.userId!);
    reply.send(withdrawals);
  });

  // POST /withdrawals/:id/complete (process the approved withdrawal)
  app.post('/:id/complete', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = await withdrawalService.completeWithdrawal(id);
    reply.send(result);
  });
}