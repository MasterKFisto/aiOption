import { getPrisma } from '../../config/database.js';
import { ledgerService } from '../ledger/service.js';
import { walletService } from '../wallets/service.js';
import type { Asset } from '@ai-options/shared';
import { AppError } from '../../utils/errors.js';
import { gteDec } from '../../utils/decimal.js';

export class WithdrawalService {
  async requestWithdrawal(userId: string, asset: Asset, amount: string, destinationAddress: string) {
    const wallet = await walletService.getWallet(userId);

    const available = await ledgerService.getAvailableBalance(userId, wallet.id, asset);
    if (!gteDec(available, amount)) {
      throw AppError.badRequest('Insufficient balance');
    }

    const prisma = getPrisma();
    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId, walletId: wallet.id, asset, amount,
        destinationAddress, status: 'REQUESTED',
      },
    });

    await ledgerService.lockBalance({
      userId, walletId: wallet.id, asset, amount,
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawal.id,
    });

    return withdrawal;
  }

  async getWithdrawals(userId: string) {
    const prisma = getPrisma();
    return prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async approveWithdrawal(withdrawalId: string, adminUserId: string) {
    const prisma = getPrisma();
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw AppError.notFound('Withdrawal not found');
    if (withdrawal.status !== 'REQUESTED') throw AppError.badRequest('Withdrawal is not in REQUESTED status');

    const updated = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'APPROVED', approvedBy: adminUserId },
    });

    return updated;
  }

  async rejectWithdrawal(withdrawalId: string, adminUserId: string, reason: string) {
    const prisma = getPrisma();
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw AppError.notFound('Withdrawal not found');
    if (withdrawal.status !== 'REQUESTED') throw AppError.badRequest('Withdrawal is not in REQUESTED status');

    const updated = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'REJECTED', rejectedBy: adminUserId, reason },
    });

    // Unlock the funds
    await ledgerService.unlockBalance({
      userId: withdrawal.userId,
      walletId: withdrawal.walletId,
      asset: withdrawal.asset as Asset,
      amount: withdrawal.amount.toString(),
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawal.id,
    });

    return updated;
  }

  async completeWithdrawal(withdrawalId: string) {
    const prisma = getPrisma();
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw AppError.notFound('Withdrawal not found');
    if (withdrawal.status !== 'APPROVED') throw AppError.badRequest('Withdrawal is not in APPROVED status');

    // Unlock and debit for real
    await ledgerService.unlockBalance({
      userId: withdrawal.userId,
      walletId: withdrawal.walletId,
      asset: withdrawal.asset as Asset,
      amount: withdrawal.amount.toString(),
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawal.id,
    });

    await ledgerService.debit({
      userId: withdrawal.userId,
      walletId: withdrawal.walletId,
      asset: withdrawal.asset as Asset,
      amount: withdrawal.amount.toString(),
      eventType: 'WITHDRAWAL_COMPLETE',
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawal.id,
      metadata: { destination: withdrawal.destinationAddress },
    });

    return prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'COMPLETED' },
    });
  }
}

export const withdrawalService = new WithdrawalService();