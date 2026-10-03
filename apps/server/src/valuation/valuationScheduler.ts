import { listOpenBinaryContracts } from '../binary/binaryRepository.js';
import { listPositions } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { logger } from '../logger.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import { portfolioUnrealized } from './unrealizedPnl.js';

export const VALUATION_INTERVAL_MS = 2_000;

let timer: NodeJS.Timeout | null = null;
let lastPublished = '';

/**
 * Re-values open positions every 2 s (Phase 6.5.3) and pushes an
 * `unrealized` SSE event so the dashboard updates live. Only runs work while
 * something is open, and only publishes when the numbers changed. Settlement
 * stays with the 1 s option/binary settlement schedulers.
 */
export function startValuationScheduler(): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    try {
      const anyOpen = listPositions('OPEN').length > 0 || listOpenBinaryContracts().length > 0;
      if (!anyOpen && lastPublished === '') {
        return;
      }
      const snapshot = portfolioUnrealized(liveMarket.getLatestTick()?.price ?? 0);
      const key = JSON.stringify(snapshot);
      if (key !== lastPublished) {
        lastPublished = anyOpen ? key : '';
        publishEvent('unrealized', snapshot);
      }
    } catch (err) {
      logger.error({ err }, 'valuation tick failed');
    }
  }, VALUATION_INTERVAL_MS);
  logger.info({ intervalMs: VALUATION_INTERVAL_MS }, 'unrealized PnL valuation started');
}

export function stopValuationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastPublished = '';
}
