import { z } from 'zod';

export const simulateDepositSchema = z.object({
  asset: z.enum(['USDC', 'ETH', 'BTC']),
  amount: z.string().refine(
    (v: string) => {
      const n = parseFloat(v);
      return !isNaN(n) && n > 0 && n <= 1_000_000;
    },
    { message: 'Amount must be between 0 and 1,000,000' },
  ),
});

export const depositResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  walletId: z.string(),
  asset: z.string(),
  amount: z.string(),
  status: z.string(),
  createdAt: z.string().datetime(),
});

export type SimulateDepositInput = z.infer<typeof simulateDepositSchema>;