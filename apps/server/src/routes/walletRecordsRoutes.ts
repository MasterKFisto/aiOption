import type { FastifyInstance } from 'fastify';

import type { WalletRecordsSummary } from '@aioption/shared';

import {
  getAccount,
  getWalletRecordById,
  listDeposits,
  listWalletRecords,
  listWithdrawals,
} from '../db/repositories.js';
import { getTronStatus } from '../services/tronStatusService.js';

const KINDS = ['ALL', 'DEPOSIT', 'WITHDRAWAL', 'TRADE', 'FEE', 'REFUND', 'FEE_DEPOSIT'] as const;

/**
 * Unified wallet records. Registered with prefix /api.
 *   GET /api/wallet/records?type=ALL&limit=100&offset=0
 *   GET /api/wallet/records/:id
 */
export async function walletRecordsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/wallet/records', async (request, reply) => {
    const query = request.query as { type?: string; limit?: string; offset?: string };
    const type = (query.type ?? 'ALL').toUpperCase();
    if (!(KINDS as readonly string[]).includes(type)) {
      return reply.code(400).send({ error: `type must be one of ${KINDS.join(', ')}` });
    }
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const records = listWalletRecords(type, limit, offset);

    // Summary header for the page.
    const account = getAccount();
    const tron = getTronStatus();
    const summary: WalletRecordsSummary = {
      availableBalance: account.cashBalance,
      lockedBalance: account.lockedBalance,
      totalEquity: account.equity,
      pendingWithdrawals: listWithdrawals(50)
        .filter((w) => ['REQUESTED', 'PENDING_FEE', 'APPROVED', 'BROADCAST'].includes(w.status))
        .reduce((sum, w) => sum + w.amount, 0),
      pendingDeposits: listDeposits(50)
        .filter((d) => ['DETECTED', 'CONFIRMING', 'PENDING'].includes(d.status))
        .reduce((sum, d) => sum + d.amount, 0),
      hotWalletTrxBalance: tron.trxBalance,
      feeResourcesSufficient: !tron.lowFeeResource,
    };
    return { records, summary };
  });

  app.get('/wallet/records/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = getWalletRecordById(id);
    if (!record) {
      return reply.code(404).send({ error: 'wallet record not found' });
    }
    return record;
  });
}
