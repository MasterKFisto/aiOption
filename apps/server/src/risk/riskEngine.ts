import { roundMoney } from '@aioption/shared';
import type { AiDecision } from '@aioption/shared';

import { config } from '../config.js';
import { getAccount, listPositions, logRiskEvent, updateAccount } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { optionService } from '../options/optionService.js';
import type { OptionService } from '../options/optionService.js';
import type { WalletService } from '../services/walletService.js';
import { directionGuard } from '../strategy/directionGuard.js';
import type { DirectionGuard } from '../strategy/directionGuard.js';

export interface RiskEvaluation {
  approved: boolean;
  reason: string | null;
}

/**
 * Enforces the strict risk controls before a trade can execute, and monitors
 * the account's loss limit:
 *
 *   1. trading must be enabled
 *   2. open positions must be below `maxOpenPositions` (0 = unlimited, default)
 *   3. the proposed trade size must equal the fixed `FIXED_TRADE_SIZE_USD`
 *   4. if equity <= startingEquity * (1 - lossLimitPercent / 100): close all
 *      open positions, disable trading, and log a risk event
 */
export class RiskEngine {
  /**
   * `wallet` is kept for API compatibility (callers and tests construct the
   * engine with it); position funds are now released via OptionService.
   */
  constructor(
    wallet: WalletService,
    private readonly options: OptionService = optionService,
    private readonly guard: DirectionGuard = directionGuard,
  ) {
    void wallet;
  }

  /** Evaluates a decision against the current account state. */
  evaluate(decision: AiDecision): RiskEvaluation {
    const account = getAccount();

    if (!account.tradingEnabled) {
      return { approved: false, reason: 'trading is disabled' };
    }
    if (decision.signal === 'NEUTRAL') {
      return { approved: false, reason: 'neutral signal — no trade' };
    }
    if (decision.proposedTradeSizeUsd > account.maxOptionStakeUsd) {
      logRiskEvent({
        type: 'MAX_STAKE_LIMIT_REJECTED',
        message:
          `trade rejected: proposed size ${decision.proposedTradeSizeUsd} exceeds the ` +
          `${account.maxOptionStakeUsd} USDT maximum stake`,
        equityAtTrigger: account.equity,
      });
      return {
        approved: false,
        reason:
          `proposed trade size ${decision.proposedTradeSizeUsd} exceeds the ` +
          `${account.maxOptionStakeUsd} USDT maximum stake`,
      };
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
    // Open-position cap: 0 (default) = unlimited number of trades. Money is
    // protected by the stake, available-balance and loss limits above/below.
    if (account.maxOpenPositions > 0) {
      const openPositions = listPositions('OPEN');
      if (openPositions.length >= account.maxOpenPositions) {
        return {
          approved: false,
          reason:
            `open positions (${openPositions.length}) reached the limit ` +
            `(${account.maxOpenPositions})`,
        };
      }
    }
    // Phase 6.5.2: anti one-sided-loop — the signal engine already rebalances
    // a streak-blocked side to the opposite one; this is the final safety net
    // (blocks only this direction; the opposite stays allowed).
    const direction = decision.signal === 'BULLISH' ? 'CALL' : 'PUT';
    const directional = this.guard.check(direction);
    if (!directional.allowed) {
      return { approved: false, reason: directional.reason };
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
    const event = logRiskEvent({
      type: 'LOSS_LIMIT_DAILY',
      message:
        `Loss limit triggered: equity ${roundMoney(account.equity)} ${account.baseCurrency} <= ` +
        `threshold ${roundMoney(threshold)} ${account.baseCurrency} ` +
        `(${account.lossLimitPercent}% of starting equity ${roundMoney(account.startingEquity)})`,
      equityAtTrigger: account.equity,
    });
    if (account.lossLimitPercent === 40) {
      logRiskEvent({
        type: 'DAILY_LOSS_LIMIT_40_PERCENT_TRIGGERED',
        message: 'daily loss limit of 40% reached — trading halted',
        equityAtTrigger: account.equity,
      });
    }
    publishEvent('risk', event);
    return { triggered: true };
  }

  /**
   * Emergency close on a loss-limit trigger: refunds the EXACT stake of each
   * open classic option (atomic claim + unlock per position), so locked
   * funds are released 1:1 and no fee residue stays locked.
   */
  private closeAllOpenPositions(): void {
    this.options.refundAllOpenPositions('loss limit reached — emergency close');
  }
}
