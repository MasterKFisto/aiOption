import { getPrisma } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { subDec, addDec, gteDec } from '../../utils/decimal.js';
import type { Asset, LedgerEventType } from '@ai-options/shared';
import type { Prisma } from '@prisma/client';

export class LedgerService {
  async ensureAccount(userId: string, walletId: string, asset: Asset, accountType: 'BALANCE' | 'LOCKED' | 'PENDING' = 'BALANCE') {
    const prisma = getPrisma();
    let account = await prisma.ledgerAccount.findFirst({
      where: { userId, walletId, asset, accountType },
    });
    if (!account) {
      account = await prisma.ledgerAccount.create({
        data: { userId, walletId, asset, accountType },
      });
    }
    return account;
  }

  async recordEntry(params: {
    userId: string; accountId: string; asset: Asset; debit: string; credit: string;
    eventType: LedgerEventType; referenceType: string; referenceId: string;
    metadata?: Record<string, unknown>;
  }) {
    const prisma = getPrisma();
    if (parseFloat(params.debit) < 0 || parseFloat(params.credit) < 0) {
      throw AppError.badRequest('Ledger amounts must be non-negative');
    }
    return prisma.ledgerEntry.create({
      data: {
        userId: params.userId, accountId: params.accountId, asset: params.asset,
        debit: params.debit, credit: params.credit, eventType: params.eventType,
        referenceType: params.referenceType, referenceId: params.referenceId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async credit(params: {
    userId: string; walletId: string; asset: Asset; amount: string;
    eventType: LedgerEventType; referenceType: string; referenceId: string;
    metadata?: Record<string, unknown>;
  }) {
    const account = await this.ensureAccount(params.userId, params.walletId, params.asset, 'BALANCE');
    return this.recordEntry({
      userId: params.userId, accountId: account.id, asset: params.asset,
      credit: params.amount, debit: '0.000000', eventType: params.eventType,
      referenceType: params.referenceType, referenceId: params.referenceId,
      metadata: params.metadata,
    });
  }

  async debit(params: {
    userId: string; walletId: string; asset: Asset; amount: string;
    eventType: LedgerEventType; referenceType: string; referenceId: string;
    metadata?: Record<string, unknown>;
  }) {
    const account = await this.ensureAccount(params.userId, params.walletId, params.asset, 'BALANCE');
    return this.recordEntry({
      userId: params.userId, accountId: account.id, asset: params.asset,
      debit: params.amount, credit: '0.000000', eventType: params.eventType,
      referenceType: params.referenceType, referenceId: params.referenceId,
      metadata: params.metadata,
    });
  }

  async lockBalance(params: {
    userId: string; walletId: string; asset: Asset; amount: string;
    referenceType: string; referenceId: string;
  }) {
    const available = await this.getAvailableBalance(params.userId, params.walletId, params.asset);
    if (!gteDec(available, params.amount)) {
      throw AppError.badRequest('Insufficient balance to lock');
    }
    const balanceAccount = await this.ensureAccount(params.userId, params.walletId, params.asset, 'BALANCE');
    const lockedAccount = await this.ensureAccount(params.userId, params.walletId, params.asset, 'LOCKED');
    await this.recordEntry({
      userId: params.userId, accountId: balanceAccount.id, asset: params.asset,
      debit: params.amount, credit: '0.000000', eventType: 'ADJUSTMENT',
      referenceType: params.referenceType, referenceId: params.referenceId,
      metadata: { action: 'lock' },
    });
    await this.recordEntry({
      userId: params.userId, accountId: lockedAccount.id, asset: params.asset,
      debit: '0.000000', credit: params.amount, eventType: 'ADJUSTMENT',
      referenceType: params.referenceType, referenceId: params.referenceId,
      metadata: { action: 'lock' },
    });
  }

  async unlockBalance(params: {
    userId: string; walletId: string; asset: Asset; amount: string;
    referenceType: string; referenceId: string;
  }) {
    const locked = await this.getLockedBalance(params.userId, params.walletId, params.asset);
    if (!gteDec(locked, params.amount)) {
      throw AppError.badRequest('Insufficient locked balance to unlock');
    }
    const balanceAccount = await this.ensureAccount(params.userId, params.walletId, params.asset, 'BALANCE');
    const lockedAccount = await this.ensureAccount(params.userId, params.walletId, params.asset, 'LOCKED');
    await this.recordEntry({
      userId: params.userId, accountId: lockedAccount.id, asset: params.asset,
      debit: params.amount, credit: '0.000000', eventType: 'ADJUSTMENT',
      referenceType: params.referenceType, referenceId: params.referenceId,
      metadata: { action: 'unlock' },
    });
    await this.recordEntry({
      userId: params.userId, accountId: balanceAccount.id, asset: params.asset,
      debit: '0.000000', credit: params.amount, eventType: 'ADJUSTMENT',
      referenceType: params.referenceType, referenceId: params.referenceId,
      metadata: { action: 'unlock' },
    });
  }
async getAvailableBalance(userId: string, walletId: string, asset: Asset): Promise<string> {
    const prisma = getPrisma();
    const account = await prisma.ledgerAccount.findFirst({
      where: { userId, walletId, asset, accountType: 'BALANCE' },
    });
    if (!account) return '0.000000';
    const result = await prisma.ledgerEntry.aggregate({
      _sum: { credit: true, debit: true },
      where: { accountId: account.id },
    });
    const credit = result._sum.credit?.toString() ?? '0';
    const debit = result._sum.debit?.toString() ?? '0';
    return subDec(credit, debit);
  }

  async getLockedBalance(userId: string, walletId: string, asset: Asset): Promise<string> {
    const prisma = getPrisma();
    const account = await prisma.ledgerAccount.findFirst({
      where: { userId, walletId, asset, accountType: 'LOCKED' },
    });
    if (!account) return '0.000000';
    const result = await prisma.ledgerEntry.aggregate({
      _sum: { credit: true, debit: true },
      where: { accountId: account.id },
    });
    const credit = result._sum.credit?.toString() ?? '0';
    const debit = result._sum.debit?.toString() ?? '0';
    return subDec(credit, debit);
  }

  async getWalletBalances(userId: string, walletId: string): Promise<Record<string, { available: string; locked: string; total: string }>> {
    const prisma = getPrisma();
    const accounts = await prisma.ledgerAccount.findMany({
      where: { userId, walletId },
      distinct: ['asset'],
    });
    const assets = [...new Set(accounts.map((a) => a.asset))];
    const balances: Record<string, { available: string; locked: string; total: string }> = {};
    for (const asset of assets) {
      const available = await this.getAvailableBalance(userId, walletId, asset as Asset);
      const locked = await this.getLockedBalance(userId, walletId, asset as Asset);
      balances[asset] = { available, locked, total: addDec(available, locked) };
    }
    return balances;
  }

  async getLedgerEntries(userId: string, limit = 50, offset = 0) {
    const prisma = getPrisma();
    return prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}

export const ledgerService = new LedgerService();