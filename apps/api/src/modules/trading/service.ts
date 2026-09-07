import { getPrisma } from '../../config/database.js';
import { config } from '../../config/index.js';
import type { Asset, OptionType } from '@ai-options/shared';

export class TradingSettingsService {
  async getSettings(userId: string) {
    const prisma = getPrisma();
    let settings = await prisma.tradingSettings.findUnique({ where: { userId } });

    if (!settings) {
      settings = await prisma.tradingSettings.create({
        data: {
          userId,
          autoTradingEnabled: false,
          maxTradeSizeUsd: config.trading.defaultMaxTradeUsd,
          dailyLossLimitUsd: config.trading.defaultDailyLossLimitUsd,
          weeklyLossLimitUsd: config.trading.defaultWeeklyLossLimitUsd,
          maxOpenPositions: config.trading.defaultMaxOpenPositions,
        },
      });
    }

    return settings;
  }

  async updateSettings(userId: string, data: {
    autoTradingEnabled?: boolean;
    maxTradeSizeUsd?: string;
    dailyLossLimitUsd?: string;
    weeklyLossLimitUsd?: string;
    maxOpenPositions?: number;
    reinvestProfits?: boolean;
    allowedAssets?: Asset[];
    allowedOptionTypes?: OptionType[];
    minAiConfidence?: number;
    maxSlippagePercent?: number;
    maxSpreadPercent?: number;
    stopLossPercent?: number;
    takeProfitPercent?: number;
    continuousTrading?: boolean;
  }) {
    const prisma = getPrisma();

    await this.getSettings(userId); // Ensure settings exist

    return prisma.tradingSettings.update({
      where: { userId },
      data,
    });
  }
}

export const tradingSettingsService = new TradingSettingsService();