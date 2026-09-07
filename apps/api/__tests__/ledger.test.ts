import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Prisma client module before importing services
const mockPrisma = {
  ledgerAccount: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  ledgerEntry: {
    create: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('../src/config/database.js', () => ({
  getPrisma: () => mockPrisma,
}));

import { LedgerService } from '../src/modules/ledger/service.js';

describe('LedgerService', () => {
  let ledger: LedgerService;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger = new LedgerService();
  });

  describe('ensureAccount', () => {
    it('returns existing account when found', async () => {
      const existing = { id: 'acct-1', userId: 'u1', walletId: 'w1', asset: 'USDC', accountType: 'BALANCE' };
      mockPrisma.ledgerAccount.findFirst.mockResolvedValue(existing);

      const result = await ledger.ensureAccount('u1', 'w1', 'USDC');

      expect(result).toEqual(existing);
      expect(mockPrisma.ledgerAccount.create).not.toHaveBeenCalled();
    });

    it('creates account when not found', async () => {
      mockPrisma.ledgerAccount.findFirst.mockResolvedValue(null);
      const created = { id: 'acct-new', userId: 'u1', walletId: 'w1', asset: 'USDC', accountType: 'BALANCE' };
      mockPrisma.ledgerAccount.create.mockResolvedValue(created);

      const result = await ledger.ensureAccount('u1', 'w1', 'USDC');

      expect(result).toEqual(created);
      expect(mockPrisma.ledgerAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u1', walletId: 'w1', asset: 'USDC', accountType: 'BALANCE' },
      });
    });
  });

  describe('recordEntry', () => {
    it('rejects negative debit amounts', async () => {
      await expect(
        ledger.recordEntry({
          userId: 'u1', accountId: 'a1', asset: 'USDC', debit: '-5', credit: '0',
          eventType: 'DEPOSIT', referenceType: 'DEPOSIT', referenceId: 'd1',
        }),
      ).rejects.toThrow('Ledger amounts must be non-negative');
    });

    it('rejects negative credit amounts', async () => {
      await expect(
        ledger.recordEntry({
          userId: 'u1', accountId: 'a1', asset: 'USDC', debit: '0', credit: '-5',
          eventType: 'DEPOSIT', referenceType: 'DEPOSIT', referenceId: 'd1',
        }),
      ).rejects.toThrow('Ledger amounts must be non-negative');
    });

    it('records a valid entry', async () => {
      mockPrisma.ledgerEntry.create.mockResolvedValue({ id: 'entry-1' });
      const result = await ledger.recordEntry({
        userId: 'u1', accountId: 'a1', asset: 'USDC', debit: '0', credit: '100',
        eventType: 'DEPOSIT', referenceType: 'DEPOSIT', referenceId: 'd1',
      });
      expect(result).toEqual({ id: 'entry-1' });
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAvailableBalance', () => {
    it('returns zero when no account exists', async () => {
      mockPrisma.ledgerAccount.findFirst.mockResolvedValue(null);
      const balance = await ledger.getAvailableBalance('u1', 'w1', 'USDC');
      expect(balance).toBe('0.000000');
    });

    it('computes balance as credits minus debits', async () => {
      mockPrisma.ledgerAccount.findFirst.mockResolvedValue({ id: 'a1' });
      mockPrisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { credit: { toString: () => '150.000000' }, debit: { toString: () => '25.500000' } },
      });
      const balance = await ledger.getAvailableBalance('u1', 'w1', 'USDC');
      expect(balance).toBe('124.500000');
    });
  });

  describe('lockBalance', () => {
    it('rejects locking more than available', async () => {
      mockPrisma.ledgerAccount.findFirst.mockResolvedValue({ id: 'balance-acct' });
      mockPrisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { credit: { toString: () => '10.000000' }, debit: { toString: () => '0.000000' } },
      });
      await expect(
        ledger.lockBalance({ userId: 'u1', walletId: 'w1', asset: 'USDC', amount: '50', referenceType: 'WITHDRAWAL', referenceId: 'w1' }),
      ).rejects.toThrow('Insufficient balance to lock');
    });
  });

  describe('unlockBalance', () => {
    it('rejects unlocking more than locked', async () => {
      mockPrisma.ledgerAccount.findFirst.mockResolvedValue({ id: 'locked-acct' });
      mockPrisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { credit: { toString: () => '5.000000' }, debit: { toString: () => '0.000000' } },
      });
      await expect(
        ledger.unlockBalance({ userId: 'u1', walletId: 'w1', asset: 'USDC', amount: '50', referenceType: 'WITHDRAWAL', referenceId: 'w1' }),
      ).rejects.toThrow('Insufficient locked balance to unlock');
    });
  });
});