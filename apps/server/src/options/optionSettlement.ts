import { logger } from '../logger.js';
import type { OptionService } from './optionService.js';

let timer: NodeJS.Timeout | null = null;

/**
 * Classic-option settlement scheduler: runs every second, settles expired
 * positions against the latest valid market price (grace period + refund on
 * stale data). Individual settlements are atomic via UPDATE-where-OPEN guards.
 */
export function startOptionSettlement(service: OptionService): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    try {
      service.settleDueOptions();
    } catch (err) {
      logger.error({ err }, 'option settlement tick failed');
    }
  }, 1000);
  logger.info('option settlement scheduler started (1s)');
}

export function stopOptionSettlement(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
