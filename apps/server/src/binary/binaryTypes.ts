import type { BinaryDirection, PriceTick } from '@aioption/shared';

/** Minimal price-feed surface for binary entry/settlement (injectable). */
export interface BinaryPriceFeed {
  getLatestTick(): PriceTick | null;
  getTickAtOrAfter(timestampIso: string): PriceTick | null;
}

export interface OpenBinaryInput {
  asset: string;
  direction: BinaryDirection;
  stakeUsd: number;
  durationSeconds: number;
  payoutRatio: number;
  /** MANUAL_BINARY (default) or AI_BINARY. */
  source?: string;
}
