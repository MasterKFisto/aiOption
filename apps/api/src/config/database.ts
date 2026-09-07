import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: config.isDevelopment()
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    });
    logger.info('Prisma client initialized');
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Prisma client disconnected');
  }
}

export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];