import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { listSettingsAudit } from '../db/repositories.js';
import {
  AddressValidationError,
  getWalletAddresses,
  updateWalletAddresses,
} from '../services/appSettings.js';
import { validateTronAddress } from '../services/tronAddress.js';

// Bounded strings: rejects oversized payloads before validation runs.
const addressField = z.string().max(128).optional();

const updateSchema = z
  .object({
    usdtTradeAddress: addressField,
    withdrawalDestinationAddress: addressField,
    trxFeeWalletAddress: addressField,
  })
  .strict()
  .refine(
    (value) =>
      value.usdtTradeAddress !== undefined ||
      value.withdrawalDestinationAddress !== undefined ||
      value.trxFeeWalletAddress !== undefined,
    { message: 'provide at least one address' },
  );

const validateSchema = z.object({ address: z.string().max(128) }).strict();

/**
 * User-editable Tron addresses (Phase 6.5.1). Registered with prefix /api.
 * Only PUBLIC addresses are stored/returned — never keys or signing config.
 *
 *   GET  /api/wallet/addresses
 *   PUT  /api/wallet/addresses          { usdtTradeAddress?, withdrawalDestinationAddress?, trxFeeWalletAddress? }
 *   POST /api/wallet/addresses/validate { address }
 *   GET  /api/settings/audit            settings/address change log
 */
export async function walletAddressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/wallet/addresses', async () => getWalletAddresses());

  app.put('/wallet/addresses', async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    try {
      const update = Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      );
      return updateWalletAddresses(update);
    } catch (err) {
      if (err instanceof AddressValidationError) {
        return reply.code(400).send({ error: err.message, field: err.field, reason: err.reason });
      }
      throw err;
    }
  });

  app.post('/wallet/addresses/validate', async (request, reply) => {
    const parsed = validateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    return validateTronAddress(parsed.data.address);
  });

  app.get('/settings/audit', async (request) => {
    const { limit } = request.query as { limit?: string };
    const parsed = Number(limit ?? 50);
    return listSettingsAudit(Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50);
  });
}
