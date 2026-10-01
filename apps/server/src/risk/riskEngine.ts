import { roundMoney } from '@aioption/shared';
import type { AiDecision } from '@aioption/shared';

import { config } from '../config.js';
import {
  getAccount,
  listPositions,
  logRiskEvent,
  updateAccount,
  updatePosition,
} from '../db/repositories.js';
import type { WalletService } from '../services/walletService.js';

export interface RiskEvaluation {
  approved: boolean;
  reason: string | null;
}

/**
 * Enforces the strict risk controls before a trade can execute, and monitors
 * the account's loss limit:
 *
 *   1. trading must be enabled
 *   2. open positions must be below `maxOpenPositions`
 *   3. the proposed trade size must equal the fixed `FIXED_TRADE_SIZE_USD`
 *   4. if equity <= startingEquity * (1 - lossLimitPercent / 100): close all
 *      open positions, disable trading, and log a risk event
 */
export class RiskEngine {
  constructor(private readonly wallet: WalletService) {}

  /** Evaluates a decision against the current account state. */
  evaluate(decision: AiDecision): RiskEvaluation {
    const account = getAccount();

    if (!account.tradingEnabled) {
      return { approved: false, reason: 'trading is disabled' };
    }
    if (decision.signal === 'NEUTRAL') {
      return { approved: false, reason: 'neutral signal — no trade' };
    }
    if (decision.proposedTradeSizeUsd !== config.FIXED_TRADE_SIZE_USD) {
      return {
        approved: false,
        reason:
          `proposed trade size ${decision.proposedTradeSizeUsd} does not match ` +
          `the fixed limit ${config.FIXED_TRADE_SIZE_USD}`,
      };
    }
    if (account.cashBalance < decision.proposedTradeSizeUsd) {
      return {
        approved: false,
        reason:
          `insufficient cash balance (${account.cashBalance}) ` +
          `for a ${decision.proposedTradeSizeUsd} trade`,
      };
    }
    const openPositions = listPositions('OPEN');
    if (openPositions.length >= account.maxOpenPositions) {
      return {
        approved: false,
        reason:
          `open positions (${openPositions.length}) reached the limit ` +
          `(${account.maxOpenPositions})`,
      };
    }
    return { approved: true, reason: null };
  }

  /**
   * Loss-limit check. On trigger: closes all open positions (at entry
   * premium — MVP simplification), unlocks their funds, disables trading and
   * logs a risk event.
   */
  checkLossLimit(): { triggered: boolean } {
    const account = getAccount();
    if (!account.tradingEnabled || account.startingEquity <= 0) {
      return { triggered: false };
    }

    const threshold = account.startingEquity * (1 - account.lossLimitPercent / 100);
    if (account.equity > threshold) {
      return { triggered: false };
    }

    this.closeAllOpenPositions();
    updateAccount({ tradingEnabled: false });
    logRiskEvent({
      type: 'LOSS_LIMIT_DAILY',
      message:
        `Loss limit triggered: equity ${roundMoney(account.equity)} ${account.baseCurrency} <= ` +
        `threshold ${roundMoney(threshold)} ${account.baseCurrency} ` +
        `(${account.lossLimitPercent}% of starting equity ${roundMoney(account.startingEquity)})`,
      equityAtTrigger: account.equity,
    });
    return { triggered: true };
  }

  private closeAllOpenPositions(): void {
    const closedAt = new Date().toISOString();
    for (const position of listPositions('OPEN')) {
      updatePosition(position.id, {
        status: 'CLOSED',
        exitPremium: position.entryPremium,
        realizedPnl: 0,
        closedAt,
      });
      this.wallet.unlockFunds(
        roundMoney(position.quantity * position.entryPremium),
        `emergency close of ${position.symbol}`,
      );
    }
  }
}
