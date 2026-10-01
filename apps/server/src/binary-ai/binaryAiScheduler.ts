import { config } from '../config.js';
import { logger } from '../logger.js';
import type { AiBinaryService } from './binaryAiService.js';

let timer: NodeJS.Timeout | null = null;

/**
 * AI evaluation scheduler: runs the AI loop every AI_BINARY_EVALUATION_INTERVAL_MS
 * when AI binary trading is enabled. The loop is non-blocking (the evaluation
 * itself is synchronous and fast — one signal + at most one contract open).
 */
export function startAiBinaryScheduler(service: AiBinaryService): void {
  if (timer || !config.AI_BINARY_ENABLED) {
    return;
  }
  timer = setInterval(() => {
    try {
      service.evaluateOnce();
    } catch (err) {
      logger.error({ err }, 'AI binary evaluation tick failed');
    }
  }, config.AI_BINARY_EVALUATION_INTERVAL_MS);
  logger.info(
    { intervalMs: config.AI_BINARY_EVALUATION_INTERVAL_MS },
    'AI binary scheduler started',
  );
}

export function stopAiBinaryScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
