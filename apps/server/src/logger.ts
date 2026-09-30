import { pino } from 'pino';

/**
 * Shared Pino logger for the server.
 * The log level can be overridden via the LOG_LEVEL env variable.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});
