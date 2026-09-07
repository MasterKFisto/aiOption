import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { authService } = await import('../auth/service.js');
    const user = await authService.getMe(req.userId!);
    reply.send(user);
  });
}