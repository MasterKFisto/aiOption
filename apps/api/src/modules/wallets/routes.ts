import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../auth/routes.js';
import { walletService } from './service.js';
import { ledgerService } from '../ledger/service.js';

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  // GET /wallets
  app.get('/', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const wallets = await walletService.getWallets(req.userId!);
    
    // Enrich with balances
    const enriched = await Promise.all(
      wallets.map(async (w) => {
        const balances = await ledgerService.getWalletBalances(req.userId!, w.id);
        return { ...w, balances };
      })
    );

    reply.send(enriched);
  });

  // GET /wallets/:id
  app.get('/:id', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const wallet = await walletService.getWallet(req.userId!);
    if (wallet.id !== id) {
      reply.status(404).send({ error: 'NOT_FOUND', message: 'Wallet not found' });
      return;
    }
    const balances = await ledgerService.getWalletBalances(req.userId!, wallet.id);
    reply.send({ ...wallet, balances });
  });

  // GET /wallets/balance
  app.get('/:id/balance', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const balances = await ledgerService.getWalletBalances(req.userId!, id);
    reply.send(balances);
  });

  // GET /wallets/:id/ledger
  app.get('/:id/ledger', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string; offset?: string };
    const entries = await ledgerService.getLedgerEntries(
      req.userId!,
      query.limit ? parseInt(query.limit) : 50,
      query.offset ? parseInt(query.offset) : 0,
    );
    reply.send(entries);
  });
}