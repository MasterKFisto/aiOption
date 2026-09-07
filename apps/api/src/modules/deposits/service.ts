import { getPrisma } from '../../config/database.js';
import { ledgerService } from '../ledger/service.js';
import { walletService } from '../wallets/service.js';
import type { Asset } from '@ai-options/shared';
import { config } from '../../config/index.js';
import { AppError } from '../../utils/errors.js';

export class DepositService {
  async simulateDeposit(userId: string, asset: Asset, amount: string) {
    if (!config.assets.supported.includes(asset)) {
      throw AppError.badRequest(`Asset ${asset} is not supported`);
    }

    const wallet = await walletService.getOrCreateWallet(userId);

    const prisma = getPrisma();
    const deposit = await prisma.deposit.create({
      data: { userId, walletId: wallet.id, asset, amount, status: 'COMPLETED' },
    });

    await ledgerService.credit({
      userId, walletId: wallet.id, asset, amount,
      eventType: 'DEPOSIT',
      referenceType: 'DEPOSIT',
      referenceId: deposit.id,
      metadata: { simulated: true },
    });

    return deposit;
  }

  async getDeposits(userId: string) {
    const prisma = getPrisma();
    return prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

export const depositService = new DepositService();