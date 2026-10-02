import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { roundMoney } from '@aioption/shared';

import { config } from '../config.js';
import { getAccount, listDeposits } from '../db/repositories.js';
import { resolveUsdcTradeAddress } from '../services/appSettings.js';
import { getLastSyncedAt, syncDepositsOnce } from '../services/depositSyncService.js';
import { tronService } from '../services/tronService.js';
import type { SimulatedTronService } from '../services/tronService.js';

const simulateSchema = z.object({
  amount: z.coerce.number().positive(),
});

/**
 * Tron USDC (TRC20) deposit endpoints. Registered with prefix /api.
 */
export async function depositRoutes(app: FastifyInstance): Promise<void> {
  app.get('/deposits/info', async () => ({
    // UI-saved trade address (Phase 6.5.1) → env → simulated placeholder.
    address: await tronService.getDepositAddress(),
    addressSource: resolveUsdcTradeAddress().source,
    network: 'TRON',
    asset: 'USDC',
    tokenStandard: 'TRC20',
    tronMode: config.TRON_MODE,
    liveWithdrawalsEnabled: config.ENABLE_LIVE_TRON_WITHDRAWALS,
    requiredConfirmations: config.TRON_REQUIRED_CONFIRMATIONS,
    lastSyncedAt: getLastSyncedAt(),
  }));

  app.get('/deposits', async () => listDeposits(50));

  app.post('/deposits/simulate', async (request, reply) => {
    if (config.MODE !== 'PAPER' && config.TRON_MODE !== 'SIMULATED') {
      return reply
        .code(403)
        .send({ error: 'simulated deposits are only available in paper/simulated mode' });
    }
    const parsed = simulateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }

    const simulated = tronService as SimulatedTronService;
    if (typeof simulated.simulateIncomingUsdc !== 'function') {
      return reply.code(400).send({ error: 'the active Tron service does not support simulation' });
    }
    simulated.simulateIncomingUsdc(roundMoney(parsed.data.amount));
    await syncDepositsOnce();

    const deposits = listDeposits(1);
    return { deposit: deposits[0] ?? null, account: getAccount() };
  });
}
