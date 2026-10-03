import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import { WalletService } from '../services/walletService.js';

const amountSchema = z.object({
  // Upper bound: no single paper movement above 1,000,000 USDT.
  amount: z.coerce.number().positive().max(1_000_000),
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

  // Security: paper (fake) deposits/withdrawals must never touch a real
  // account. Allowed only when the ledger is test-only: PAPER or TESTNET
  // mode (test networks), or the simulated Tron network. In LIVE mode anyone
  // reaching the API could otherwise mint trading balance out of thin air.
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && !config.SIMULATION_ALLOWED) {
      return reply
        .code(403)
        .send({ error: 'paper wallet operations are only available in paper/testnet/simulated mode' });
    }
    return undefined;
  });

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
