import { getPrisma } from '../../config/database.js';

export class PositionService {
  async getOpenPositions(userId: string) {
    const prisma = getPrisma();
    return prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getAllPositions(userId: string) {
    const prisma = getPrisma();
    return prisma.position.findMany({
      where: { userId },
      orderBy: { openedAt: 'desc' },
      take: 50,
    });
  }

  async getPosition(positionId: string, userId: string) {
    const prisma = getPrisma();
    return prisma.position.findFirst({
      where: { id: positionId, userId },
    });
  }
}

export const positionService = new PositionService();