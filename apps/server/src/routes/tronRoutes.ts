import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import { TRON_ADDRESS_RE } from './withdrawalRoutes.js';
import {
  checkTronHealth,
  estimateWithdrawalFee,
  getTronStatus,
} from '../services/tronStatusService.js';
import {
  getFeeDepositInfo,
  getFeeReserveStatus,
  getTrxFeeDeposits,
  simulateTrxDeposit,
} from '../services/tronFeeWalletService.js';

const estimateQuery = z.object({
  amount: z.coerce.number().positive(),
  destination: z.string().trim().regex(TRON_ADDRESS_RE, 'must be a valid Tron address'),
});

const simulateTrxSchema = z.object({
  amountTrx: z.coerce.number().positive(),
});

/**
 * Tron network status + fee estimation endpoints. Registered with prefix /api.
 * NEVER exposes private keys — only public addresses and resource numbers.
 */
export async function tronRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tron/status', async () => getTronStatus());

  app.get('/tron/health', async () => {
    const result = await checkTronHealth();
    return { healthy: result.healthy, status: result.status };
  });

  app.get('/tron/fee-estimate', async (request, reply) => {
    const parsed = estimateQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    return estimateWithdrawalFee(parsed.data.destination);
  });

  // TRX fee-wallet deposits (Phase 6.5).
  app.get('/tron/fee-deposit-info', async () => getFeeDepositInfo());

  app.get('/tron/fee-status', async () => getFeeReserveStatus());

  app.get('/tron/fee-deposits', async () => getTrxFeeDeposits(50));

  app.post('/tron/simulate-trx-deposit', async (request, reply) => {
    // Test ledgers only (PAPER/TESTNET/SIMULATED) — never in LIVE.
    if (!config.SIMULATION_ALLOWED) {
      return reply
        .code(403)
        .send({ error: 'simulated TRX deposits are only available in paper/testnet/simulated mode' });
    }
    const parsed = simulateTrxSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    return simulateTrxDeposit(parsed.data.amountTrx);
  });
}
