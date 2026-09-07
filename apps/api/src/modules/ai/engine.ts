import type { Asset, Direction, OptionType, StrikeType } from '@ai-options/shared';

export interface AiSignalInput {
  asset: Asset;
  direction: Direction;
  confidence: number;
  expectedReturn: number;
  riskScore: number;
  strategy: string;
  optionType: OptionType;
  expiryDays: number;
  strikeType: StrikeType;
  maxPremiumUsd: string;
  reason: string[];
}

/**
 * Mock AI Signal Engine for MVP.
 * In production, this would be replaced with a real ML model or
 * integration with external AI services.
 */
export class AiSignalEngine {
  private readonly cryptoPairs = [
    { asset: 'ETH' as Asset, basePrice: 2500, volatility: 0.05 },
    { asset: 'BTC' as Asset, basePrice: 62000, volatility: 0.04 },
  ];

  /**
   * Generates a set of AI trading signals for a given user.
   * This is a deterministic mock that varies signals based on time.
   */
  async generateSignals(_userId: string, maxTradeSizeUsd: string): Promise<AiSignalInput[]> {
    const signals: AiSignalInput[] = [];
    const hourSeed = new Date().getHours();

    for (const pair of this.cryptoPairs) {
      // Simulate different market conditions based on time
      const seed = (hourSeed + pair.asset.charCodeAt(0)) % 10;

      if (seed < 3) {
        // Bearish signal
        signals.push(this.createSignal(pair.asset, 'BEARISH', 'PUT', pair.volatility, maxTradeSizeUsd, hourSeed));
      } else if (seed < 7) {
        // Bullish signal
        signals.push(this.createSignal(pair.asset, 'BULLISH', 'CALL', pair.volatility, maxTradeSizeUsd, hourSeed));
      } else {
        // Neutral / no signal
        signals.push(this.createSignal(pair.asset, 'NEUTRAL', 'CALL', pair.volatility, maxTradeSizeUsd, hourSeed));
      }
    }

    return signals;
  }

  private createSignal(
    asset: Asset,
    direction: Direction,
    optionType: OptionType,
    baseVolatility: number,
    maxTradeSizeUsd: string,
    seed: number,
  ): AiSignalInput {
    const confidence = this.clamp(0.5 + (seed % 5) * 0.08, 0.4, 0.9);
    const riskScore = this.clamp(0.2 + (seed % 3) * 0.1, 0.1, 0.8);
    const expectedReturn = this.clamp(0.05 + (seed % 4) * 0.05, -0.3, 0.5);

    const strategies: Record<Direction, string[]> = {
      BULLISH: ['long_call', 'covered_call'],
      BEARISH: ['long_put', 'cash_secured_put'],
      NEUTRAL: ['covered_call', 'cash_secured_put'],
    };

    const reasons = [
      (seed % 3 === 0 ? 'momentum' : 'trend_signal'),
      'volatility',
      seed % 2 === 0 ? 'order_book_imbalance' : 'support_resistance',
    ];

    return {
      asset,
      direction,
      confidence,
      expectedReturn,
      riskScore,
      strategy: strategies[direction][seed % 2] ?? 'long_call',
      optionType,
      expiryDays: 3 + (seed % 7),
      strikeType: direction === 'BULLISH' ? 'ATM' : 'OTM',
      maxPremiumUsd: maxTradeSizeUsd,
      reason: reasons,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

export const aiSignalEngine = new AiSignalEngine();