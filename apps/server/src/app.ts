import cors from '@fastify/cors';
import Fastify from 'fastify';

import { binaryRoutes } from './binary/binaryRoutes.js';
import { binaryService } from './binary/binaryService.js';
import { getBinarySessionService } from './binary/binarySessionService.js';
import { startBinarySettlement, stopBinarySettlement } from './binary/binarySettlement.js';
import { getAiBinaryService } from './binary-ai/binaryAiService.js';
import { binaryAiRoutes } from './binary-ai/binaryAiRoutes.js';
import { startAiBinaryScheduler, stopAiBinaryScheduler } from './binary-ai/binaryAiScheduler.js';
import { optionService } from './options/optionService.js';
import { classicRoutes } from './options/classicRoutes.js';
import { optionRoutes } from './options/optionRoutes.js';
import { startOptionSettlement, stopOptionSettlement } from './options/optionSettlement.js';
import { config } from './config.js';
import { getDb, initDb } from './db/connection.js';
import { getAccount } from './db/repositories.js';
import { logger } from './logger.js';
import { liveMarket } from './market/liveMarketDataService.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { depositRoutes } from './routes/depositRoutes.js';
import { eventRoutes } from './routes/eventRoutes.js';
import { marketRoutes } from './routes/marketRoutes.js';
import { tradingRoutes } from './routes/tradingRoutes.js';
import { tronRoutes } from './routes/tronRoutes.js';
import { walletAddressRoutes } from './routes/walletAddressRoutes.js';
import { walletRecordsRoutes } from './routes/walletRecordsRoutes.js';
import { walletRoutes } from './routes/walletRoutes.js';
import { withdrawalRoutes } from './routes/withdrawalRoutes.js';
import { tradingLoop } from './scheduler/tradingLoop.js';
import { createOriginMatcher, createRequestGuard } from './security/requestGuard.js';
import { startValuationScheduler, stopValuationScheduler } from './valuation/valuationScheduler.js';
import { startDepositSync, stopDepositSync } from './services/depositSyncService.js';
import { startTronProbe, stopTronProbe } from './services/tronStatusService.js';
import { adminRoutes } from './admin/adminRoutes.js';
import { registerWebApp } from './webApp.js';

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

  // CORS: only allow the configured browser origins (localhost frontend by
  // default). '*' keeps the previous reflect-any-origin behavior if needed.
  // Same matcher as the CSRF guard, so 127.0.0.1:5173 / [::1]:5173 behave
  // exactly like the configured localhost:5173 (all are this machine).
  const isAllowedOrigin = createOriginMatcher(config.CORS_ORIGINS);
  await app.register(cors, {
    origin: config.CORS_ORIGINS.includes('*')
      ? true
      : (origin, callback) => callback(null, origin !== undefined && isAllowedOrigin(origin)),
  });

  // DNS-rebinding (Host allow-list) + CSRF (foreign-origin writes) guard.
  app.addHook(
    'onRequest',
    createRequestGuard({
      allowedHosts: config.ALLOWED_HOSTS,
      allowedOrigins: config.CORS_ORIGINS,
    }),
  );

  // Baseline security headers on every response (API + SSE).
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  // Open the SQLite database and run migrations before serving any traffic.
  // Migrations also repair locked_balance = sum of open stakes (Phase 6.5.1).
  initDb();

  // Paper wallet management (POST /api/paper/deposit, POST /api/paper/withdraw, ...).
  await app.register(walletRoutes, { prefix: '/api/paper' });

  // Trading loop control + risk settings.
  await app.register(tradingRoutes, { prefix: '/api/trading' });

  // Read-only dashboard data for the web frontend.
  await app.register(dashboardRoutes, { prefix: '/api' });

  // Live market data (public source) for the dashboard.
  await app.register(marketRoutes, { prefix: '/api/market' });

  // Tron USDT (TRC20) deposits and withdrawals.
  await app.register(depositRoutes, { prefix: '/api' });
  await app.register(withdrawalRoutes, { prefix: '/api' });

  // Server-sent events for near-real-time UI updates.
  await app.register(eventRoutes, { prefix: '/api' });

  // Binary options (internal-ledger settlement).
  await app.register(binaryRoutes, { prefix: '/api' });

  // AI binary trading (signals + optional auto-execution of binary contracts).
  await app.register(binaryAiRoutes, { prefix: '/api' });

  // Classic short-duration options (Phase 6.4) + controls/settings (6.5.1).
  await app.register(optionRoutes, { prefix: '/api' });
  await app.register(classicRoutes, { prefix: '/api' });

  // User-editable Tron addresses + settings audit (Phase 6.5.1).
  await app.register(walletAddressRoutes, { prefix: '/api' });

  // Tron status/health/fee endpoints + unified wallet records (Phase 6.4).
  await app.register(tronRoutes, { prefix: '/api' });
  await app.register(walletRecordsRoutes, { prefix: '/api' });

  // Admin / UAT endpoints — 404 unless ENABLE_ADMIN_API=true (Phase 7).
  await app.register(adminRoutes, { prefix: '/api' });

  // Background loops: live market polling + Tron deposit sync.
  liveMarket.start();
  startDepositSync();
  startTronProbe();
  startBinarySettlement(binaryService);
  const binarySession = getBinarySessionService();
  const aiBinary = getAiBinaryService();
  startAiBinaryScheduler(aiBinary);
  startOptionSettlement(optionService);
  startValuationScheduler();
  app.addHook('onClose', async () => {
    stopValuationScheduler();
    liveMarket.stop();
    stopDepositSync();
    stopTronProbe();
    stopBinarySettlement();
    stopAiBinaryScheduler();
    stopOptionSettlement();
    binarySession.dispose();
    aiBinary.dispose();
  });

  // Requirement: start the trading loop on boot only if trading is enabled in the DB.
  if (getAccount().tradingEnabled) {
    tradingLoop.start();
  }

  app.get('/api/health', async () => {
    const dbCheck = getDb().prepare<[], { ok: number }>('SELECT 1 AS ok').get();
    return {
      status: 'ok',
      mode: config.MODE,
      // Phase 7: safety posture for the ECS health check (no secrets).
      tronMode: config.TRON_MODE,
      liveTronWithdrawalsEnabled: config.ENABLE_LIVE_TRON_WITHDRAWALS,
      binaryLiveTradingEnabled: config.BINARY_LIVE_TRADING_ENABLED,
      aiBinaryLiveAutoTradingEnabled: config.AI_BINARY_LIVE_AUTO_TRADING_ENABLED,
      adminApiEnabled: config.ENABLE_ADMIN_API,
      database: dbCheck?.ok === 1 ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // Production: serve the built SPA from the same origin (Phase 7). Only the
  // dist directory is exposed — never data/, backups/ or .env.
  if (config.WEB_DIST_DIR) {
    await registerWebApp(app, config.WEB_DIST_DIR);
  }

  return app;
}
