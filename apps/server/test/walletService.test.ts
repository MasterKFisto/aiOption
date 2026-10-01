import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-wallet-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let wallet: InstanceType<typeof import('../src/services/walletService.js')['WalletService']>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { WalletService } = await import('../src/services/walletService.js');
  connection.initDb();
  wallet = new WalletService();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  repo.updateAccount({ cashBalance: 0, lockedBalance: 0, equity: 0 });
});

describe('WalletService', () => {
  it('deposit increases cash and equity and logs a DEPOSIT transaction', () => {
    const before = repo.listTransactions().length;
    const { transaction, account } = wallet.deposit(1000, 'seed');
    expect(transaction.type).toBe('DEPOSIT');
    expect(transaction.amount).toBe(1000);
    expect(transaction.currency).toBe('USDC');
    expect(account.cashBalance).toBe(1000);
    expect(account.equity).toBe(1000);
    expect(repo.listTransactions().length).toBe(before + 1);
  });

  it('withdraw decreases balances and logs a negative WITHDRAWAL', () => {
    wallet.deposit(1000);
    const { transaction, account } = wallet.withdraw(300);
    expect(transaction.type).toBe('WITHDRAWAL');
    expect(transaction.amount).toBe(-300);
    expect(account.cashBalance).toBe(700);
    expect(account.equity).toBe(700);
  });

  it('rejects withdrawals above the cash balance', () => {
    wallet.deposit(100);
    expect(() => wallet.withdraw(101)).toThrow(/Insufficient funds/);
    expect(wallet.getBalances().cashBalance).toBe(100); // unchanged
  });

  it('rejects non-positive amounts', () => {
    expect(() => wallet.deposit(0)).toThrow(/positive/);
    expect(() => wallet.deposit(-5)).toThrow(/positive/);
    expect(() => wallet.withdraw(Number.NaN)).toThrow(/positive/);
    expect(() => wallet.lockFunds(0)).toThrow(/positive/);
  });

  it('lockFunds moves cash into the locked balance and logs an ADJUSTMENT', () => {
    wallet.deposit(1000);
    const { transaction, account } = wallet.lockFunds(400);
    expect(account.cashBalance).toBe(600);
    expect(account.lockedBalance).toBe(400);
    expect(account.equity).toBe(1000); // locking does not change equity
    expect(transaction.type).toBe('ADJUSTMENT');
    expect(transaction.amount).toBe(-400);
  });

  it('unlockFunds returns locked funds to cash', () => {
    wallet.deposit(1000);
    wallet.lockFunds(400);
    const { account } = wallet.unlockFunds(400);
    expect(account.cashBalance).toBe(1000);
    expect(account.lockedBalance).toBe(0);
  });

  it('rejects locking more than cash and unlocking more than locked', () => {
    wallet.deposit(50);
    expect(() => wallet.lockFunds(51)).toThrow(/Insufficient cash/);
    wallet.lockFunds(50);
    expect(() => wallet.unlockFunds(51)).toThrow(/Cannot unlock/);
  });

  it('every wallet movement creates a transaction record', () => {
    const before = repo.listTransactions().length;
    wallet.deposit(100);
    wallet.withdraw(10);
    wallet.lockFunds(20);
    wallet.unlockFunds(20);
    const after = repo.listTransactions();
    expect(after.length).toBe(before + 4);
    const types = after.slice(0, 4).map((t) => t.type).sort();
    expect(types).toEqual(['ADJUSTMENT', 'ADJUSTMENT', 'DEPOSIT', 'WITHDRAWAL']);
  });
});
