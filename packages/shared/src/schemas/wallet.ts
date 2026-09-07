import { z } from 'zod';

export const walletResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  walletType: z.string(),
  walletAddress: z.string().nullable(),
  chain: z.string(),
  status: z.string(),
  balance: z.record(z.string(), z.string()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const balanceResponseSchema = z.object({
  asset: z.string(),
  available: z.string(),
  locked: z.string(),
  total: z.string(),
});