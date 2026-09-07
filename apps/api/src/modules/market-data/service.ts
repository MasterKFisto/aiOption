import type { Asset } from '@ai-options/shared';
import { getPrisma } from '../../config/database.js';

export class MarketDataService {
  private getSpotPrice(asset: Asset): number {
    const seed = Date.now() % 10000 / 10000;
    const prices: Record<string, number> = {
      BTC: 62000 + seed * 2000 - 1000,
      ETH: 2500 + seed * 100 - 50,
      USDC: 1.0,
      USD: 1.0,
    };
    return prices[asset] ?? 0;
  }

  async getSpotPriceStr(asset: Asset): Promise<string> {
    return this.getSpotPrice(asset).toFixed(6);
  }

  async getVolatility(asset: Asset): Promise<number> {
    const vols: Record<string, number> = {
      BTC: 0.04 + (Math.random() * 0.02),
      ETH: 0.05 + (Math.random() * 0.03),
      USDC: 0.001,
      USD: 0.001,
    };
    return vols[asset] ?? 0.05;
  }

  async getMarketSnapshot(asset: Asset) {
    const prisma = getPrisma();
    const spot = this.getSpotPrice(asset);
    const vol = await this.getVolatility(asset);

    const snapshot = await prisma.marketSnapshot.create({
      data: {
        asset,
        spotPrice: spot.toFixed(6),
        volatility: vol.toFixed(4),
      },
    });

    return snapshot;
  }

  async getLatestSnapshots() {
    const prisma = getPrisma();
    const assets = ['BTC', 'ETH', 'USDC'];
    const snapshots: Record<string, unknown> = {};

    for (const asset of assets) {
      const latest = await prisma.marketSnapshot.findFirst({
        where: { asset },
        orderBy: { timestamp: 'desc' },
      });
      if (latest) snapshots[asset] = latest;
    }

    return snapshots;
  }
}

export const marketDataService = new MarketDataService();