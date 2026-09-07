import { getPrisma } from '../../config/database.js';

export class OrderService {
  async getOrders(userId: string) {
    const prisma = getPrisma();
    return prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getOrder(orderId: string, userId: string) {
    const prisma = getPrisma();
    return prisma.order.findFirst({
      where: { id: orderId, userId },
    });
  }
}

export const orderService = new OrderService();