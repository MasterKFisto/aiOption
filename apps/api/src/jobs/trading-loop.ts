import { getPrisma } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { aiSignalEngine } from '../modules/ai/engine.js';
import { riskEngine } from '../modules/risk/engine.js';
import { paperOptionsVenue } from '../modules/options-venue/paper-venue.js';
import { ledgerService } from '../modules/ledger/service.js';
import { walletService } from '../modules/wallets/service.js';
import { adminService } from '../modules/admin/service.js';
import type { Asset } from '@ai-options/shared';

let loopTimer: ReturnType<typeof setInterval> | null = null;

export async function startTradingLoop(): Promise<void> {
  if (loopTimer) return;
  logger.info({ interval: config.trading.loopIntervalMs }, 'Starting trading loop');
  await executeTradingCycle();
  loopTimer = setInterval(async () => {
    try { await executeTradingCycle(); } catch (err) { logger.error({ err }, 'Trading cycle error'); }
  }, config.trading.loopIntervalMs);
}

export async function stopTradingLoop(): Promise<void> {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; logger.info('Trading loop stopped'); }
}

async function executeTradingCycle(): Promise<void> {
  if (adminService.isKillSwitchActive()) { logger.info('Trading skipped - kill switch'); return; }
  const prisma = getPrisma();
  const usersWithSettings = await prisma.tradingSettings.findMany({
    where: { autoTradingEnabled: true },
    select: { userId: true, maxTradeSizeUsd: true },
  });
  if (usersWithSettings.length === 0) return;
  logger.info({ userCount: usersWithSettings.length }, 'Trading cycle');
  for (const { userId, maxTradeSizeUsd } of usersWithSettings) {
    try { await processUserSignal(userId, maxTradeSizeUsd.toString()); }
    catch (err) { logger.error({ err, userId }, 'Error processing user signal'); }
  }
  try { await paperOptionsVenue.settleExpiredPositions(); }
  catch (err) { logger.error({ err }, 'Settle expired positions error'); }
}
async function processUserSignal(userId: string, maxTradeSizeUsd: string): Promise<void> {
  const prisma = getPrisma();
  const signals = await aiSignalEngine.generateSignals(userId, maxTradeSizeUsd);
  for (const signal of signals) {
    if (signal.direction === 'NEUTRAL') continue;
    const aiSignal = await prisma.aiSignal.create({
      data: { userId, asset: signal.asset, direction: signal.direction, confidence: signal.confidence, expectedReturn: signal.expectedReturn, riskScore: signal.riskScore, strategy: signal.strategy, optionType: signal.optionType, expiryDays: signal.expiryDays, strikeType: signal.strikeType, maxPremiumUsd: signal.maxPremiumUsd, reason: signal.reason },
    });
    const riskResults = await riskEngine.validateSignal(userId, signal);
    for (const result of riskResults) {
      await prisma.riskEvent.create({ data: { userId, signalId: aiSignal.id, checkName: result.checkName, passed: result.passed, reason: result.reason } });
    }
    const allPassed = await riskEngine.allChecksPassed(riskResults);
    if (!allPassed) {
      await prisma.aiSignal.update({ where: { id: aiSignal.id }, data: { executed: false } });
      continue;
    }
    const orderResult = await paperOptionsVenue.executeOrder({
      userId, asset: signal.asset, optionType: signal.optionType, side: 'BUY', strikeType: signal.strikeType, expiryDays: signal.expiryDays, maxPremiumUsd: signal.maxPremiumUsd, quantity: 1,
    });
    if (orderResult.status === 'FILLED') {
      // Order + position were created atomically by the venue adapter;
      // link the signal to the order for auditability
      await prisma.order.update({ where: { id: orderResult.orderId }, data: { signalId: aiSignal.id } });
      const wallet = await walletService.getWallet(userId);
      await ledgerService.debit({ userId, walletId: wallet.id, asset: 'USDC' as Asset, amount: orderResult.filledPremiumUsd, eventType: 'OPTION_PREMIUM_PAID', referenceType: 'ORDER', referenceId: orderResult.orderId });
      const fee = (parseFloat(orderResult.filledPremiumUsd) * 0.001).toFixed(6);
      if (parseFloat(fee) > 0) {
        await ledgerService.debit({ userId, walletId: wallet.id, asset: 'USDC' as Asset, amount: fee, eventType: 'PLATFORM_FEE', referenceType: 'ORDER', referenceId: orderResult.orderId });
      }
      await prisma.aiSignal.update({ where: { id: aiSignal.id }, data: { executed: true } });
      logger.info({ userId, signalId: aiSignal.id, orderId: orderResult.orderId, premium: orderResult.filledPremiumUsd }, 'Trade executed');
    } else {
      // Record rejected venue orders for auditability
      await prisma.order.create({
        data: { id: orderResult.orderId, userId, signalId: aiSignal.id, venue: 'PAPER', asset: signal.asset, optionType: signal.optionType, side: 'BUY', strikeType: signal.strikeType, expiryDays: signal.expiryDays, premiumLimitUsd: signal.maxPremiumUsd, actualPremiumUsd: '0', status: 'FAILED' },
      });
      logger.warn({ userId, signalId: aiSignal.id, reason: 'quote exceeds max premium' }, 'Venue rejected order');
    }
  }
}