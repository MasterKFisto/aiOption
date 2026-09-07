import type { Asset, OptionType, StrikeType, OptionQuote, OptionOrderRequest, OptionOrderResult, OptionPosition, OptionCloseResult } from '@ai-options/shared';
import { v4 as uuid } from 'uuid';
import { getPrisma } from '../../config/database.js';
import { mulDec, subDec } from '../../utils/decimal.js';

/**
 * Simplified option pricing model for paper trading.
 * Uses a basic implied volatility approach to estimate option premiums.
 * Premiums are priced in MVP scale (fixed $1,000 notional) so the default
 * $10 max trade size can fill orders.
 * NOT for production use - mock implementation.
 */
function estimatePremium(spot: number, strike: number, daysToExpiry: number, volatility: number, optionType: OptionType): string {
  const time = daysToExpiry / 365;
  const volComponent = volatility * Math.sqrt(time); // % of spot
  const moneyness = Math.abs(spot - strike) / spot; // fraction of spot
  let premiumPct: number;
  if (optionType === 'CALL') {
    premiumPct = Math.max(0, moneyness * 0.2 + volComponent * 0.4);
  } else {
    premiumPct = Math.max(0, moneyness * 0.2 + volComponent * 0.4);
  }
  const notional = 1000; // MVP paper contract notional in USD
  const premium = premiumPct * notional;
  return Math.max(premium, 1).toFixed(6);
}

function getSpotPrice(asset: Asset): number {
  const prices: Record<string, number> = { BTC: 62000 + Math.random() * 2000, ETH: 2500 + Math.random() * 100, USDC: 1.0, USD: 1.0 };
  return prices[asset] ?? 0;
}

function getVolatility(asset: Asset): number {
  const vols: Record<string, number> = { BTC: 0.04 + Math.random() * 0.02, ETH: 0.05 + Math.random() * 0.03, USDC: 0.001, USD: 0.001 };
  return vols[asset] ?? 0.05;
}

function calculateStrike(spot: number, strikeType: StrikeType): number {
  switch (strikeType) { case 'ATM': return spot; case 'ITM': return spot * 0.99; case 'OTM': return spot * 1.01; default: return spot; }
}

export class PaperOptionsVenueAdapter {
  async getQuote(asset: Asset, optionType: OptionType, strikeType: StrikeType, expiryDays: number): Promise<OptionQuote> {
    const spot = getSpotPrice(asset);
    const vol = getVolatility(asset);
    const strike = calculateStrike(spot, strikeType);
    const mid = estimatePremium(spot, strike, expiryDays, vol, optionType);
    const spread = parseFloat(mid) * 0.03;
    const bid = Math.max(0, parseFloat(mid) - spread).toFixed(6);
    const ask = (parseFloat(mid) + spread).toFixed(6);
    return {
      asset, optionType, strikeType, expiryDays, strikePrice: strike.toFixed(6),
      premiumUsd: mid, bidUsd: bid, askUsd: ask,
      spreadPercent: ((spread / parseFloat(mid)) * 100).toFixed(2),
      slippageEstimate: '0.01', timestamp: new Date(), venue: 'PAPER',
    };
  }

  async executeOrder(request: OptionOrderRequest): Promise<OptionOrderResult> {
    const quote = await this.getQuote(request.asset, request.optionType, request.strikeType, request.expiryDays);
    const premium = request.side === 'BUY' ? quote.askUsd : quote.bidUsd;
    const totalCost = mulDec(premium, request.quantity.toString());

    if (parseFloat(totalCost) > parseFloat(request.maxPremiumUsd)) {
      return { orderId: uuid(), status: 'REJECTED', filledPremiumUsd: '0.000000', filledQuantity: 0, positionId: '', venue: 'PAPER', timestamp: new Date() };
    }

    const orderId = uuid();
    const positionId = uuid();
    const prisma = getPrisma();
    const expiresAt = new Date(Date.now() + request.expiryDays * 24 * 60 * 60 * 1000);

    // Create order and position atomically (position FK references order)
    await prisma.$transaction([
      prisma.order.create({
        data: {
          id: orderId, userId: request.userId, venue: 'PAPER', asset: request.asset,
          optionType: request.optionType, side: request.side, strikeType: request.strikeType,
          expiryDays: request.expiryDays, premiumLimitUsd: request.maxPremiumUsd,
          actualPremiumUsd: premium, quantity: request.quantity, status: 'FILLED',
        },
      }),
      prisma.position.create({
        data: {
          id: positionId, userId: request.userId, orderId, asset: request.asset,
          optionType: request.optionType, strikePrice: quote.strikePrice,
          entryPremiumUsd: premium, expiresAt, status: 'OPEN',
        },
      }),
    ]);

    return { orderId, status: 'FILLED', filledPremiumUsd: premium, filledQuantity: request.quantity, positionId, venue: 'PAPER', timestamp: new Date() };
  }
async getPosition(positionId: string): Promise<OptionPosition | null> {
    const prisma = getPrisma();
    const pos = await prisma.position.findUnique({ where: { id: positionId } });
    if (!pos) return null;
    const spot = getSpotPrice(pos.asset as Asset);
    const vol = getVolatility(pos.asset as Asset);
    const daysRemaining = Math.max(0, Math.ceil((pos.expiresAt.getTime() - Date.now()) / 86400000));
    const currentValue = estimatePremium(spot, parseFloat(pos.strikePrice.toString()), daysRemaining, vol, pos.optionType as OptionType);
    return {
      positionId: pos.id, userId: pos.userId, asset: pos.asset as Asset,
      optionType: pos.optionType as OptionType, entryPremiumUsd: pos.entryPremiumUsd.toString(),
      currentValueUsd: currentValue, unrealizedPnlUsd: subDec(currentValue, pos.entryPremiumUsd.toString()),
      expiresAt: pos.expiresAt, openedAt: pos.openedAt,
    };
  }

  async closePosition(positionId: string): Promise<OptionCloseResult> {
    const prisma = getPrisma();
    const pos = await prisma.position.findUnique({ where: { id: positionId } });
    if (!pos) throw new Error('Position not found');
    const spot = getSpotPrice(pos.asset as Asset);
    const vol = getVolatility(pos.asset as Asset);
    const daysRemaining = Math.max(0, Math.ceil((pos.expiresAt.getTime() - Date.now()) / 86400000));
    let realizedPnl: string;
    if (daysRemaining === 0) {
      // Expired - intrinsic value at MVP notional scale
      const isCall = pos.optionType === 'CALL';
      const strike = parseFloat(pos.strikePrice.toString());
      const moneyness = isCall ? Math.max(0, (spot - strike) / spot) : Math.max(0, (strike - spot) / spot);
      realizedPnl = (moneyness * 1000).toFixed(6);
    } else {
      realizedPnl = estimatePremium(spot, parseFloat(pos.strikePrice.toString()), daysRemaining, vol, pos.optionType as OptionType);
    }
    realizedPnl = subDec(realizedPnl, pos.entryPremiumUsd.toString());
    await prisma.position.update({
      where: { id: positionId },
      data: { status: daysRemaining === 0 ? 'EXPIRED' : 'CLOSED', currentValueUsd: realizedPnl, realizedPnlUsd: realizedPnl, closedAt: new Date() },
    });
    return { positionId, closeValueUsd: realizedPnl, realizedPnlUsd: realizedPnl, status: daysRemaining === 0 ? 'EXPIRED' : 'CLOSED', timestamp: new Date() };
  }

  async settleExpiredPositions(): Promise<void> {
    const prisma = getPrisma();
    const expired = await prisma.position.findMany({ where: { status: 'OPEN', expiresAt: { lte: new Date() } } });
    for (const pos of expired) {
      const closeResult = await this.closePosition(pos.id);
      const pnlStr = closeResult.realizedPnlUsd;
      const { ledgerService } = await import('../ledger/service.js');
      const { walletService } = await import('../wallets/service.js');
      const wallet = await walletService.getWallet(pos.userId);
      if (parseFloat(pnlStr) > 0) {
        await ledgerService.credit({
          userId: pos.userId, walletId: wallet.id, asset: 'USDC' as Asset, amount: pnlStr,
          eventType: 'OPTION_SETTLEMENT_PROFIT', referenceType: 'POSITION', referenceId: pos.id,
        });
      } else if (parseFloat(pnlStr) < 0) {
        await ledgerService.debit({
          userId: pos.userId, walletId: wallet.id, asset: 'USDC' as Asset,
          amount: Math.abs(parseFloat(pnlStr)).toFixed(6),
          eventType: 'OPTION_SETTLEMENT_LOSS', referenceType: 'POSITION', referenceId: pos.id,
        });
      }
    }
  }
}

export const paperOptionsVenue = new PaperOptionsVenueAdapter();