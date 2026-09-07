import { getPrisma } from '../../config/database.js';
import { withdrawalService } from '../withdrawals/service.js';

let tradingKillSwitch = false;

export class AdminService {
  async getUsers(limit = 50) {
    const prisma = getPrisma();
    return prisma.user.findMany({
      select: { id: true, email: true, status: true, jurisdiction: true, kycStatus: true, createdAt: true },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWithdrawals(status?: string) {
    const prisma = getPrisma();
    return prisma.withdrawal.findMany({
      where: status ? { status: status as any } : {},
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async approveWithdrawal(withdrawalId: string, adminUserId: string) {
    return withdrawalService.approveWithdrawal(withdrawalId, adminUserId);
  }

  async rejectWithdrawal(withdrawalId: string, adminUserId: string, reason: string) {
    return withdrawalService.rejectWithdrawal(withdrawalId, adminUserId, reason);
  }

  enableKillSwitch(): void {
    tradingKillSwitch = true;
  }

  disableKillSwitch(): void {
    tradingKillSwitch = false;
  }

  isKillSwitchActive(): boolean {
    return tradingKillSwitch;
  }
}

export const adminService = new AdminService();