import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { WalletService } from '../services/walletService.js';

const amountSchema = z.object({
  amount: z.coerce.number().positive(),
  description: z.string().trim().max(500).optional(),
});

/**
 * Manual paper-fund management for testing.
 *
 * Registered with prefix /api/paper:
 *   POST /api/paper/deposit   { amount, description? }
 *   POST /api/paper/withdraw  { amount, description? }
 *   GET  /api/paper/balances
 */
export async function walletRoutes(app: FastifyInstance): Promise<void> {
  const wallet = new WalletService();

  app.get('/balances', async () => wallet.getBalances());

  app.post('/deposit', async (request, reply) => {
    const parsed = amountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    try {
      const result = wallet.deposit(parsed.data.amount, parsed.data.description);
      return reply.code(201).send(result);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'deposit failed' });
    }
  });

  app.post('/withdraw', async (request, reply) => {
    const parsed = amountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    try {
      const result = wallet.withdraw(parsed.data.amount, parsed.data.description);
      return reply.code(201).send(result);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'withdraw failed' });
    }
  });
}
