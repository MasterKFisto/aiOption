import { z } from 'zod';

export const updateTradingSettingsSchema = z.object({
  autoTradingEnabled: z.boolean().optional(),
  maxTradeSizeUsd: z.string().optional(),
  dailyLossLimitUsd: z.string().optional(),
  weeklyLossLimitUsd: z.string().optional(),
  maxOpenPositions: z.number().int().min(1).max(50).optional(),
  reinvestProfits: z.boolean().optional(),
  allowedAssets: z.array(z.enum(['USDC', 'ETH', 'BTC'])).optional(),
  allowedOptionTypes: z.array(z.enum(['CALL', 'PUT'])).optional(),
  minAiConfidence: z.number().min(0).max(1).optional(),
  maxSlippagePercent: z.number().min(0).max(100).optional(),
  maxSpreadPercent: z.number().min(0).max(100).optional(),
  stopLossPercent: z.number().min(0).max(100).optional(),
  takeProfitPercent: z.number().min(0).max(1000).optional(),
  continuousTrading: z.boolean().optional(),
});

export const tradingSettingsResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  autoTradingEnabled: z.boolean(),
  maxTradeSizeUsd: z.string(),
  dailyLossLimitUsd: z.string(),
  weeklyLossLimitUsd: z.string(),
  maxOpenPositions: z.number(),
  reinvestProfits: z.boolean(),
  allowedAssets: z.array(z.string()),
  allowedOptionTypes: z.array(z.string()),
  minAiConfidence: z.number(),
  maxSlippagePercent: z.number(),
  maxSpreadPercent: z.number(),
  stopLossPercent: z.number(),
  takeProfitPercent: z.number(),
  continuousTrading: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UpdateTradingSettingsInput = z.infer<typeof updateTradingSettingsSchema>;