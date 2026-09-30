import { roundMoney } from '@aioption/shared';
import type { Account, Transaction } from '@aioption/shared';

import { getAccount, logTransaction, updateAccount } from '../db/repositories.js';

export interface WalletResult {
  transaction: Transaction;
  account: Account;
}

function assertPositive(amount: number, label: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

/**
 * Paper wallet: manages the account's cash and locked balances. Every wallet
 * movement updates the account AND writes a corresponding record into the
 * transactions table via the repository.
 */
export class WalletService {
  getBalances(): Account {
    return getAccount();
  }

  /** Adds paper funds to the account. */
  deposit(amount: number, description?: string): WalletResult {
    assertPositive(amount, 'Deposit amount');
    const account = getAccount();
    updateAccount({
      cashBalance: roundMoney(account.cashBalance + amount),
      equity: roundMoney(account.equity + amount),
    });
    const transaction = logTransaction({
      type: 'DEPOSIT',
      amount: roundMoney(amount),
      currency: account.baseCurrency,
      description: description ?? 'paper deposit',
      positionId: null,
    });
    return { transaction, account: getAccount() };
  }

  /** Removes paper funds from the account. */
  withdraw(amount: number, description?: string): WalletResult {
    assertPositive(amount, 'Withdrawal amount');
    const account = getAccount();
    if (amount > account.cashBalance + 1e-9) {
      throw new Error(
        `Insufficient funds: requested ${amount} ${account.baseCurrency} but only ${account.cashBalance} available`,
      );
    }
    updateAccount({
      cashBalance: roundMoney(account.cashBalance - amount),
      equity: roundMoney(account.equity - amount),
    });
    const transaction = logTransaction({
      type: 'WITHDRAWAL',
      amount: roundMoney(-amount),
      currency: account.baseCurrency,
      description: description ?? 'paper withdrawal',
      positionId: null,
    });
    return { transaction, account: getAccount() };
  }

  /** Reserves cash for an open position (moves it into the locked balance). */
  lockFunds(amount: number, description?: string): WalletResult {
    assertPositive(amount, 'Lock amount');
    const account = getAccount();
    if (amount > account.cashBalance + 1e-9) {
      throw new Error(
        `Insufficient cash to lock ${amount} ${account.baseCurrency} (available: ${account.cashBalance})`,
      );
    }
    updateAccount({
      cashBalance: roundMoney(account.cashBalance - amount),
      lockedBalance: roundMoney(account.lockedBalance + amount),
    });
    const transaction = logTransaction({
      type: 'ADJUSTMENT',
      amount: roundMoney(-amount),
      currency: account.baseCurrency,
      description: description ?? 'funds locked for trade',
      positionId: null,
    });
    return { transaction, account: getAccount() };
  }

  /** Releases locked funds back to cash (e.g. when a position is closed). */
  unlockFunds(amount: number, description?: string): WalletResult {
    assertPositive(amount, 'Unlock amount');
    const account = getAccount();
    if (amount > account.lockedBalance + 1e-9) {
      throw new Error(
        `Cannot unlock ${amount} ${account.baseCurrency} (locked: ${account.lockedBalance})`,
      );
    }
    updateAccount({
      cashBalance: roundMoney(account.cashBalance + amount),
      lockedBalance: roundMoney(account.lockedBalance - amount),
    });
    const transaction = logTransaction({
      type: 'ADJUSTMENT',
      amount: roundMoney(amount),
      currency: account.baseCurrency,
      description: description ?? 'locked funds released',
      positionId: null,
    });
    return { transaction, account: getAccount() };
  }
}
