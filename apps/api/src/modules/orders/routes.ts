import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { orderService } from './service.js';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const orders = await orderService.getOrders(req.userId!);
    reply.send(orders);
  });
}