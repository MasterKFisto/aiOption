import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  jurisdiction: z.string().min(2).max(10).default('US'),
  riskAcknowledged: z.boolean().refine((v: boolean) => v === true, {
    message: 'You must acknowledge the risk disclaimer',
  }),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  status: z.string(),
  jurisdiction: z.string(),
  riskAcknowledgedAt: z.string().datetime().nullable(),
  kycStatus: z.string(),
  createdAt: z.string().datetime(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;