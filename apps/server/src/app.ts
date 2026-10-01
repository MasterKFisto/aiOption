import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './config.js';
import { getDb, initDb } from './db/connection.js';
import { getAccount } from './db/repositories.js';
import { logger } from './logger.js';
import { tradingRoutes } from './routes/tradingRoutes.js';
import { walletRoutes } from './routes/walletRoutes.js';
import { tradingLoop } from './scheduler/tradingLoop.js';

/**
 * Builds the Fastify app: logger, CORS, DB init, routes, health check, and the
 * trading-loop auto-start (only when trading is enabled in the DB).
 *
 * Kept separate from the listen call so tests can build the app and use
 * `app.inject` without opening a socket.
 */
export async function buildApp() {
  // Fastify 5 rejects pino *instances* passed via the `logger` option (that one
  // accepts only `boolean` or a pino options object). `loggerInstance` is the
  // supported way to inject an existing pino logger — Fastify wraps it with its
  // default serializers.
  const app = Fastify({
    loggerInstance: logger,
  });

  // CORS: reflect the request origin during development;
  // tighten this per MODE once the frontend exists.
  await app.register(cors, {
    origin: true,
  });

  // Open the SQLite database and run migrations before serving any traffic.
  initDb();

  // Paper wallet management (POST /api/paper/deposit, POST /api/paper/withdraw, ...).
  await app.register(walletRoutes, { prefix: '/api/paper' });

  // Trading loop control + risk settings.
  await app.register(tradingRoutes, { prefix: '/api/trading' });

  // Requirement: start the trading loop on boot only if trading is enabled in the DB.
  if (getAccount().tradingEnabled) {
    tradingLoop.start();
  }

  app.get('/api/health', async () => {
    const dbCheck = getDb().prepare<[], { ok: number }>('SELECT 1 AS ok').get();
    return {
      status: 'ok',
      mode: config.MODE,
      database: dbCheck?.ok === 1 ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  return app;
}
