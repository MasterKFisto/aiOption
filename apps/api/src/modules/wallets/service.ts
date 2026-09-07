import { getPrisma } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';

export class WalletService {
  async getOrCreateWallet(userId: string) {
    const prisma = getPrisma();
    
    let wallet = await prisma.wallet.findFirst({
      where: { userId, walletType: 'PAPER' },
    });

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          userId,
          walletType: 'PAPER',
          chain: 'PAPER',
          status: 'ACTIVE',
        },
      });
    }

    return wallet;
  }

  async getWallet(userId: string) {
    const prisma = getPrisma();
    const wallet = await prisma.wallet.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (!wallet) {
      throw AppError.notFound('Wallet not found');
    }

    return wallet;
  }

  async getWallets(userId: string) {
    const prisma = getPrisma();
    return prisma.wallet.findMany({
      where: { userId },
    });
  }
}

export const walletService = new WalletService();