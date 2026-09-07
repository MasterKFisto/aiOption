import { getPrisma } from '../../config/database.js';
import { ledgerService } from '../ledger/service.js';
import { walletService } from '../wallets/service.js';
import { tradingSettingsService } from '../trading/service.js';
import type { AiSignalInput } from '../ai/engine.js';
import type { Asset } from '@ai-options/shared';
import { gteDec, ltDec, addDec } from '../../utils/decimal.js';
import { config } from '../../config/index.js';

export interface RiskCheckResult {
  checkName: string;
  passed: boolean;
  reason: string;
}

export class RiskEngine {
  async validateSignal(userId: string, signal: AiSignalInput): Promise<RiskCheckResult[]> {
    const results: RiskCheckResult[] = [];
    const settings = await tradingSettingsService.getSettings(userId);
    const wallet = await walletService.getWallet(userId);
    const prisma = getPrisma();

    // 1: Auto trading enabled
    if (!settings.autoTradingEnabled) {
      results.push({ checkName: 'AUTO_TRADING_ENABLED', passed: false, reason: 'Auto trading is disabled' });
      return results;
    }
    results.push({ checkName: 'AUTO_TRADING_ENABLED', passed: true, reason: 'Auto trading is enabled' });

    // 2: Asset allowed
    const allowedAssets = settings.allowedAssets as string[];
    if (!allowedAssets.includes(signal.asset)) {
      results.push({ checkName: 'ASSET_ALLOWED', passed: false, reason: `Asset ${signal.asset} not allowed` });
      return results;
    }
    results.push({ checkName: 'ASSET_ALLOWED', passed: true, reason: `Asset ${signal.asset} allowed` });

    // 3: Option type allowed
    const allowedTypes = settings.allowedOptionTypes as string[];
    if (!allowedTypes.includes(signal.optionType)) {
      results.push({ checkName: 'OPTION_TYPE_ALLOWED', passed: false, reason: `Option type ${signal.optionType} not allowed` });
      return results;
    }
    results.push({ checkName: 'OPTION_TYPE_ALLOWED', passed: true, reason: 'Option type allowed' });

    // 4: AI confidence
    const minConf = settings.minAiConfidence.toNumber();
    if (signal.confidence < minConf) {
      results.push({ checkName: 'AI_CONFIDENCE', passed: false, reason: `Confidence ${signal.confidence} below ${minConf}` });
      return results;
    }
    results.push({ checkName: 'AI_CONFIDENCE', passed: true, reason: 'Confidence threshold met' });

    // 5: Max trade size
    if (ltDec(settings.maxTradeSizeUsd.toString(), signal.maxPremiumUsd)) {
      results.push({ checkName: 'MAX_TRADE_SIZE', passed: false, reason: 'Premium exceeds max trade size' });
      return results;
    }
    results.push({ checkName: 'MAX_TRADE_SIZE', passed: true, reason: 'Within max trade size' });

    // 6: Available balance
    const available = await ledgerService.getAvailableBalance(userId, wallet.id, 'USDC' as Asset);
    if (!gteDec(available, signal.maxPremiumUsd)) {
      results.push({ checkName: 'AVAILABLE_BALANCE', passed: false, reason: 'Insufficient balance' });
      return results;
    }
    results.push({ checkName: 'AVAILABLE_BALANCE', passed: true, reason: `Available: ${available}` });

    // 7: Daily loss limit
    const dailyLoss = await this.getDailyLoss(userId);
    if (gteDec(dailyLoss, settings.dailyLossLimitUsd.toString())) {
      results.push({ checkName: 'DAILY_LOSS_LIMIT', passed: false, reason: 'Daily loss limit reached' });
      return results;
    }
    results.push({ checkName: 'DAILY_LOSS_LIMIT', passed: true, reason: `Daily loss: ${dailyLoss}` });

    // 8: Weekly loss limit
    const weeklyLoss = await this.getWeeklyLoss(userId);
    if (gteDec(weeklyLoss, settings.weeklyLossLimitUsd.toString())) {
      results.push({ checkName: 'WEEKLY_LOSS_LIMIT', passed: false, reason: 'Weekly loss limit reached' });
      return results;
    }
    results.push({ checkName: 'WEEKLY_LOSS_LIMIT', passed: true, reason: `Weekly loss: ${weeklyLoss}` });

    // 9: Max open positions
    const openPositions = await prisma.position.count({
      where: { userId, status: 'OPEN' },
    });
    if (openPositions >= settings.maxOpenPositions) {
      results.push({ checkName: 'MAX_OPEN_POSITIONS', passed: false, reason: `Max open positions (${settings.maxOpenPositions}) reached` });
      return results;
    }
    results.push({ checkName: 'MAX_OPEN_POSITIONS', passed: true, reason: `Open: ${openPositions}` });

    // 10: Trading mode
    if (!config.trading.paperTrading && !config.trading.liveTradingEnabled) {
      results.push({ checkName: 'LIVE_TRADING_ENABLED', passed: false, reason: 'Live trading disabled' });
      return results;
    }
    results.push({ checkName: 'LIVE_TRADING_ENABLED', passed: true, reason: 'Trading mode valid' });

    return results;
  }
async allChecksPassed(results: RiskCheckResult[]): Promise<boolean> {
    return results.every((r) => r.passed);
  }

  private async getDailyLoss(userId: string): Promise<string> {
    const prisma = getPrisma();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        userId,
        createdAt: { gte: today },
        eventType: { in: ['OPTION_PREMIUM_PAID', 'OPTION_SETTLEMENT_LOSS', 'TRADING_FEE'] },
      },
    });
    let totalLoss = '0.000000';
    for (const e of entries) {
      totalLoss = addDec(totalLoss, e.debit.toString());
    }
    return totalLoss;
  }

  private async getWeeklyLoss(userId: string): Promise<string> {
    const prisma = getPrisma();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        userId,
        createdAt: { gte: weekAgo },
        eventType: { in: ['OPTION_PREMIUM_PAID', 'OPTION_SETTLEMENT_LOSS', 'TRADING_FEE'] },
      },
    });
    let totalLoss = '0.000000';
    for (const e of entries) {
      totalLoss = addDec(totalLoss, e.debit.toString());
    }
    return totalLoss;
  }
}

export const riskEngine = new RiskEngine();