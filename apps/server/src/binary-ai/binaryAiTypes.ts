import type { AiBinarySignal, PriceTick } from '@aioption/shared';

/** Tick source for AI signal generation (injectable for tests). */
export interface AiTickFeed {
  getRecentTicks(limit: number): PriceTick[];
  getLatestTick(): PriceTick | null;
}

export interface AiSignalResult {
  timestamp: string;
  asset: string;
  signal: AiBinarySignal;
  confidence: number;
  reason: string;
  features: Record<string, number>;
}