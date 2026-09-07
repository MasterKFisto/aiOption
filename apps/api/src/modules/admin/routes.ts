import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { adminService } from './service.js';
import { config } from '../../config/index.js';

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { authService } = await import('../auth/service.js');
    const user = await authService.getMe(req.userId!);
    if (user.email !== config.admin.email) {
      reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin access required' });
    }
  } catch {
    reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin access required' });
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/users
  app.get('/users', { preHandler: [authenticate, requireAdmin] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const users = await adminService.getUsers();
    reply.send(users);
  });

  // GET /admin/withdrawals
  app.get('/withdrawals', { preHandler: [authenticate, requireAdmin] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { status?: string };
    const withdrawals = await adminService.getWithdrawals(query.status);
    reply.send(withdrawals);
  });

  // POST /admin/withdrawals/:id/approve
  app.post('/withdrawals/:id/approve', { preHandler: [authenticate, requireAdmin] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = await adminService.approveWithdrawal(id, req.userId!);
    reply.send(result);
  });

  // POST /admin/withdrawals/:id/reject
  app.post('/withdrawals/:id/reject', { preHandler: [authenticate, requireAdmin] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { reason: string };
    const result = await adminService.rejectWithdrawal(id, req.userId!, body.reason ?? 'Rejected by admin');
    reply.send(result);
  });

  // POST /admin/trading/kill-switch
  app.post('/trading/kill-switch', { preHandler: [authenticate, requireAdmin] }, async (req: FastifyRequest, reply: FastifyReply) => {
    adminService.enableKillSwitch();
    reply.send({ message: 'Trading kill switch activated' });
  });

  // DELETE /admin/trading/kill-switch
  app.delete('/trading/kill-switch', { preHandler: [authenticate, requireAdmin] }, async (req: FastifyRequest, reply: FastifyReply) => {
    adminService.disableKillSwitch();
    reply.send({ message: 'Trading kill switch deactivated' });
  });
}