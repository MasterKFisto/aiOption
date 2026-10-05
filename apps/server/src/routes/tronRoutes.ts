import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import { setAppSetting } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { SETTING_KEYS } from '../services/appSettings.js';
import { validateTronAddress } from '../services/tronAddress.js';
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
import {
  getTokenStatus,
  resetTokenStatusCache,
  testTokenConnection,
} from '../services/tronTokenService.js';

const estimateQuery = z.object({
  amount: z.coerce.number().positive(),
  destination: z.string().trim().regex(TRON_ADDRESS_RE, 'must be a valid Tron address'),
});

const simulateTrxSchema = z.object({
  amountTrx: z.coerce.number().positive(),
});

/** Phase 7.4: update the USDT token contract (empty string clears the DB override). */
const tokenContractSchema = z
  .object({ address: z.string().trim().max(128) })
  .strict();

/**
 * Tron network status + fee estimation endpoints. Registered with prefix /api.
 * NEVER exposes private keys — only public addresses and resource numbers.
 */
export async function tronRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tron/status', async () => getTronStatus());

  // Phase 7.4: USDT TRC20 token connection status (cached ≤ 60 s).
  app.get('/tron/token-status', async () => getTokenStatus());

  // Manual "Test Token Connection" — always performs fresh chain queries.
  app.post('/tron/token-test', async () => testTokenConnection());

  // Save the USDT token contract override (DB overrides env; audit-logged).
  app.put('/tron/token-contract', async (request, reply) => {
    const parsed = tokenContractSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    const address = parsed.data.address;
    if (address !== '') {
      const validation = validateTronAddress(address);
      if (!validation.valid) {
        return reply.code(400).send({
          error: `Invalid USDT token contract address: ${validation.reason ?? 'invalid Tron address'}`,
          code: 'TOKEN_CONTRACT_INVALID',
        });
      }
    }
    setAppSetting(SETTING_KEYS.usdtTokenContract, address);
    resetTokenStatusCache();
    const status = await testTokenConnection();
    publishEvent('settings', { action: 'TOKEN_CONTRACT_UPDATED', tokenContractAddress: address });
    return status;
  });

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
