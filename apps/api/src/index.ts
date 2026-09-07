import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { getPrisma, disconnectPrisma } from './config/database.js';
import { startTradingLoop, stopTradingLoop } from './jobs/trading-loop.js';

async function main() {
  logger.info({ config: { env: config.nodeEnv, port: config.port, paperTrading: config.trading.paperTrading } }, 'Starting AI Crypto Options MVP API');

  // Initialize Prisma
  getPrisma();

  const app = await buildApp();

  // Start trading loop if enabled
  if (config.trading.loopEnabled) {
    await startTradingLoop();
    logger.info('Trading loop started');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await stopTradingLoop();
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start listening
  await app.listen({ port: config.port, host: config.host });
  logger.info(`Server running at http://${config.host}:${config.port}`);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});