import { config } from '../config.js';
import { logger } from '../logger.js';
import type { BinaryService } from './binaryService.js';

let timer: NodeJS.Timeout | null = null;

/**
 * Settlement scheduler: runs every BINARY_SETTLEMENT_INTERVAL_MS (default
 * 250ms) and settles any binary contract whose expiry has been reached.
 * Settlement is asynchronous (fire-and-forget per tick) and each individual
 * settlement is atomic, so overlapping ticks cannot double-settle.
 */
export function startBinarySettlement(service: BinaryService): void {
  if (timer || !config.BINARY_ENABLED) {
    return;
  }
  timer = setInterval(() => {
    try {
      service.settleDueContracts();
    } catch (err) {
      logger.error({ err }, 'binary settlement tick failed');
    }
  }, config.BINARY_SETTLEMENT_INTERVAL_MS);
  logger.info({ intervalMs: config.BINARY_SETTLEMENT_INTERVAL_MS }, 'binary settlement scheduler started');
}

export function stopBinarySettlement(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
