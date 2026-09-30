import cors from '@fastify/cors';
import Fastify from 'fastify';

import { config } from './config.js';
import { logger } from './logger.js';

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

app.get('/api/health', async () => ({
  status: 'ok',
  mode: config.MODE,
  timestamp: new Date().toISOString(),
  uptimeSeconds: Math.round(process.uptime()),
}));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
