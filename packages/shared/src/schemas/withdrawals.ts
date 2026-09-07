import { z } from 'zod';

export const requestWithdrawalSchema = z.object({
  asset: z.enum(['USDC', 'ETH', 'BTC']),
  amount: z.string().refine(
    (v: string) => {
      const n = parseFloat(v);
      return !isNaN(n) && n > 0 && n <= 10_000;
    },
    { message: 'Amount must be between 0 and 10,000' },
  ),
  destinationAddress: z.string().min(1, 'Destination address is required').max(256),
});

export const withdrawalResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  walletId: z.string(),
  asset: z.string(),
  amount: z.string(),
  destinationAddress: z.string(),
  status: z.string(),
  approvedBy: z.string().nullable(),
  rejectedBy: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const approveWithdrawalSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
});

export type RequestWithdrawalInput = z.infer<typeof requestWithdrawalSchema>;
export type ApproveWithdrawalInput = z.infer<typeof approveWithdrawalSchema>;