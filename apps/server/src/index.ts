import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './config.js';
import { getDb, initDb } from './db/connection.js';
import { logger } from './logger.js';
import { walletRoutes } from './routes/walletRoutes.js';

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

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
