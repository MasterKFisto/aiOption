import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { BinaryDirection, BinarySessionSettingsUpdate } from '@aioption/shared';

import { logRiskEvent } from '../db/repositories.js';
import { binaryLiveView, binaryUnrealizedMode } from '../valuation/unrealizedPnl.js';
import { getBinarySessionService } from './binarySessionService.js';
import { binaryService } from './binaryService.js';
import type { BinaryService } from './binaryService.js';

const openSchema = z.object({
  asset: z.string().trim().min(1).default('BTC/USDC'),
  direction: z.enum(['UP', 'DOWN']),
  stakeUsd: z.coerce.number().positive(),
  durationSeconds: z.coerce.number().int().positive(),
  payoutRatio: z.coerce.number().positive(),
});

const sessionSettingsSchema = z.object({
  gainLimitEnabled: z.boolean().optional(),
  maxSessionGainUsdc: z.coerce.number().positive().optional(),
  maxSessionGainPercent: z.coerce.number().min(0).max(100).optional(),
});

const quoteSchema = z.object({
  stake: z.coerce.number().positive(),
  duration: z.coerce.number().int().positive(),
  payoutRatio: z.coerce.number().positive(),
});

/**
 * Binary options endpoints. Registered with prefix /api/binary.
 * The service is injectable via options for tests.
 */
export async function binaryRoutes(
  app: FastifyInstance,
  options: { service?: BinaryService } = {},
): Promise<void> {
  const service = options.service ?? binaryService;
  app.get('/binary/config', async () => service.getConfig());

  app.get('/binary/quote', async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    try {
      return service.getQuote(parsed.data.stake, parsed.data.duration, parsed.data.payoutRatio);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'quote failed' });
    }
  });

  app.post('/binary/open', async (request, reply) => {
    const parsed = openSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    try {
      const contract = service.openBinaryContract({
        asset: parsed.data.asset,
        direction: parsed.data.direction as BinaryDirection,
        stakeUsd: parsed.data.stakeUsd,
        durationSeconds: parsed.data.durationSeconds,
        payoutRatio: parsed.data.payoutRatio,
      });
      return reply.code(201).send(contract);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'open failed';
      logRiskEvent({
        type: 'BINARY_CONTRACT_REJECTED',
        message: `binary open rejected: ${message}`,
        equityAtTrigger: 0,
      });
      return reply.code(400).send({ error: message });
    }
  });

  // Phase 6.5.3: live status (WINNING / LOSING / FLAT), countdown, potential
  // profit/loss; estimated PnL only in ESTIMATED mode (never a final result).
  app.get('/binary/open', async () => {
    const mode = binaryUnrealizedMode();
    const price = service.currentPrice();
    const nowMs = Date.now();
    return service
      .getOpenContracts()
      .map((contract) => ({ ...contract, ...binaryLiveView(contract, price, mode, nowMs) }));
  });

  app.get('/binary/history', async (request) => {
    const { limit } = request.query as { limit?: string };
    const parsed = Number(limit ?? 50);
    const safe = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;
    return service.getHistory(safe);
  });

  app.get('/binary/summary', async () => service.getSummary());

  // Binary session gain limit (Phase 6.5).
  app.get('/binary/session-stats', async () => getBinarySessionService().getStats());

  app.put('/binary/session-settings', async (request, reply) => {
    const parsed = sessionSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid settings', issues: parsed.error.issues });
    }
    try {
      const patch: BinarySessionSettingsUpdate = {};
      if (parsed.data.gainLimitEnabled !== undefined) {
        patch.gainLimitEnabled = parsed.data.gainLimitEnabled;
      }
      if (parsed.data.maxSessionGainUsdc !== undefined) {
        patch.maxSessionGainUsdc = parsed.data.maxSessionGainUsdc;
      }
      if (parsed.data.maxSessionGainPercent !== undefined) {
        patch.maxSessionGainPercent = parsed.data.maxSessionGainPercent;
      }
      return getBinarySessionService().updateSettings(patch);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'invalid settings' });
    }
  });

  app.post('/binary/session-reset', async () => getBinarySessionService().resetSession());

  // Server time — the source of truth for countdowns.
  app.get('/server-time', async () => ({
    serverTime: new Date().toISOString(),
    epochMs: Date.now(),
  }));
}
