import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { walletRoutes } from './modules/wallets/routes.js';
import { depositRoutes } from './modules/deposits/routes.js';
import { withdrawalRoutes } from './modules/withdrawals/routes.js';
import { tradingRoutes } from './modules/trading/routes.js';
import { positionRoutes } from './modules/positions/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { adminRoutes } from './modules/admin/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.isDevelopment() ? {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    } : true,
    trustProxy: true,
  });

  // CORS
  await app.register(cors, {
    origin: config.cors.origin,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });

  // JWT
  await app.register(jwt, {
    secret: config.jwt.secret,
  });

  // Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AI Crypto Options MVP API',
        version: '0.1.0',
        description: 'Paper trading API for AI-assisted crypto options trading',
      },
    },
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs',
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    paperTrading: config.trading.paperTrading,
  }));

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    } else {
      logger.error({ err: error, url: request.url }, 'Unhandled error');
      const message =
        error instanceof Error && !config.isProduction() ? error.message : 'Internal server error';
      reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message,
      });
    }
  });

  // Register routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(walletRoutes, { prefix: '/api/v1/wallets' });
  await app.register(depositRoutes, { prefix: '/api/v1/deposits' });
  await app.register(withdrawalRoutes, { prefix: '/api/v1/withdrawals' });
  await app.register(tradingRoutes, { prefix: '/api/v1/trading' });
  await app.register(positionRoutes, { prefix: '/api/v1/positions' });
  await app.register(orderRoutes, { prefix: '/api/v1/orders' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });

  return app;
}