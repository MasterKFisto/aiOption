import { roundMoney } from '@aioption/shared';
import type { OptionConfig, Position } from '@aioption/shared';

import type { BinaryPriceFeed } from '../binary/binaryTypes.js';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { recalculateLockedBalance } from '../db/migrations.js';
import type { LockedBalanceRepair } from '../db/migrations.js';
import {
  claimPositionForSettlement,
  createPosition,
  getAccount,
  listPositions,
  logRiskEvent,
  logTransaction,
  positionStake,
  sumOpenPositionStakes,
  updateAccount,
  updatePosition,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import { logger } from '../logger.js';
import { getClassicSettingsStore } from './classicSettings.js';

/** Payout ratio applied to classic option wins (fraction of the stake). */
export const OPTION_PAYOUT_RATIO = 0.8;

/** Exact user-facing rejection messages (Phase 6.5.1). */
export const CLASSIC_ERRORS = {
  insufficientBalance: 'Insufficient available balance.',
  maxStake: (max: number) => `Maximum option stake is ${max} USDC.`,
  invalidDuration: 'Invalid option duration.',
  tradingDisabled:
    'Classic Options trading is disabled — press Start Trading on the Classic Options page.',
} as const;

export type ClassicErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'MAX_STAKE'
  | 'MIN_STAKE'
  | 'INVALID_DURATION'
  | 'TRADING_DISABLED'
  | 'LOSS_LIMIT'
  | 'MARKET_DATA'
  | 'INVALID_INPUT';

/** Thrown for every rejected classic open; routes map it to HTTP 400. */
export class ClassicOptionError extends Error {
  constructor(
    message: string,
    readonly code: ClassicErrorCode,
  ) {
    super(message);
    this.name = 'ClassicOptionError';
  }
}

export interface OpenOptionInput {
  asset: string;
  side: 'CALL' | 'PUT';
  stakeUsd: number;
  /** Required — every classic option has a fixed duration. */
  durationSeconds: number;
  source?: string;
}

/**
 * Classic short-duration options.
 *
 * Locking model (Phase 6.5.1): each position locks EXACTLY its own stake
 * (stored in positions.stake_usd). Opening moves stake cash → locked;
 * settlement releases exactly that stake. lockedBalance therefore always
 * equals the sum of open stakes (classic + binary) and can be recomputed
 * from the positions table by repairLockedBalance().
 */
export class OptionService {
  constructor(private readonly feed: BinaryPriceFeed = liveMarket) {}

  getConfig(): OptionConfig {
    const settings = getClassicSettingsStore();
    return {
      minStakeUsd: config.MIN_OPTION_STAKE_USD,
      maxStakeUsd: settings.maxStakeUsd(),
      defaultStakeUsd: settings.defaultStakeUsd(),
      allowedDurationsSeconds: config.OPTION_ALLOWED_DURATIONS_SECONDS,
      defaultDurationSeconds: settings.defaultDurationSeconds(),
      maxDurationSeconds: config.OPTION_MAX_DURATION_SECONDS,
    };
  }

  /* ------------------------------ locking API ------------------------------ */

  /** Sum of the exact stakes of all OPEN classic positions. */
  calculateTotalLockedBalance(): number {
    return sumOpenPositionStakes();
  }

  /** Validates a duration against the fixed allowed set and the 60-minute cap. */
  validateDuration(durationSeconds: unknown): number {
    const allowed = config.OPTION_ALLOWED_DURATIONS_SECONDS;
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isInteger(durationSeconds) ||
      durationSeconds < Math.min(...allowed) ||
      durationSeconds > config.OPTION_MAX_DURATION_SECONDS ||
      !allowed.includes(durationSeconds)
    ) {
      throw new ClassicOptionError(CLASSIC_ERRORS.invalidDuration, 'INVALID_DURATION');
    }
    return durationSeconds;
  }

  /**
   * Stake must be > 0, within [min, max] and covered by AVAILABLE balance
   * (cash — never equity or already-locked funds).
   */
  validateAvailableBalanceForStake(stakeUsd: number): void {
    if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) {
      throw new ClassicOptionError('Stake must be a positive amount.', 'INVALID_INPUT');
    }
    const account = getAccount();
    const maxStake = getClassicSettingsStore().maxStakeUsd();
    if (stakeUsd > maxStake + 1e-9) {
      logRiskEvent({
        type: 'MAX_STAKE_LIMIT_REJECTED',
        message: `classic open rejected: stake ${stakeUsd} exceeds the ${maxStake} USDC maximum`,
        equityAtTrigger: account.equity,
      });
      throw new ClassicOptionError(CLASSIC_ERRORS.maxStake(maxStake), 'MAX_STAKE');
    }
    if (stakeUsd < config.MIN_OPTION_STAKE_USD - 1e-9) {
      throw new ClassicOptionError(
        `Minimum option stake is ${config.MIN_OPTION_STAKE_USD} USDC.`,
        'MIN_STAKE',
      );
    }
    if (stakeUsd > account.cashBalance + 1e-9) {
      throw new ClassicOptionError(CLASSIC_ERRORS.insufficientBalance, 'INSUFFICIENT_BALANCE');
    }
  }

  /** Moves exactly `stakeUsd` from available cash to locked (one ledger row). */
  lockStakeForPosition(stakeUsd: number, description: string, positionId: number | null): void {
    const stake = roundMoney(stakeUsd);
    const account = getAccount();
    if (stake > account.cashBalance + 1e-9) {
      throw new ClassicOptionError(CLASSIC_ERRORS.insufficientBalance, 'INSUFFICIENT_BALANCE');
    }
    updateAccount({
      cashBalance: roundMoney(account.cashBalance - stake),
      lockedBalance: roundMoney(account.lockedBalance + stake),
    });
    logTransaction({
      type: 'OPTION_STAKE_LOCKED',
      amount: -stake,
      currency: account.baseCurrency,
      description,
      positionId,
    });
  }

  /**
   * Releases exactly this position's stake from locked. `cashCredit` is what
   * returns to available cash (stake on refund, stake + profit on win, 0 on
   * loss); equity changes by cashCredit − stake.
   */
  unlockStakeForPosition(position: Position, cashCredit: number): void {
    const stake = positionStake(position);
    const account = getAccount();
    updateAccount({
      cashBalance: roundMoney(account.cashBalance + cashCredit),
      // Never drive locked negative even if a legacy row was mis-recorded.
      lockedBalance: roundMoney(Math.max(0, account.lockedBalance - stake)),
      equity: roundMoney(account.equity + cashCredit - stake),
    });
  }

  /** Recomputes locked = sum of open stakes; drift moves to/from available cash. */
  repairLockedBalance(): LockedBalanceRepair {
    const result = recalculateLockedBalance(getDb());
    if (result.repaired) {
      logger.warn(result, 'locked balance repaired from open positions');
      publishEvent('account', getAccount());
    }
    return result;
  }

  /* --------------------------------- open --------------------------------- */

  /**
   * Opens a classic option. Validation order: trading enabled → duration →
   * stake/balance → loss limits → fresh price. The lock + position insert
   * run in ONE SQLite transaction, so a failure can never leave cash locked
   * without a position (or vice versa).
   */
  openOption(input: OpenOptionInput): Position {
    const settings = getClassicSettingsStore();
    if (!settings.isTradingEnabled()) {
      throw new ClassicOptionError(CLASSIC_ERRORS.tradingDisabled, 'TRADING_DISABLED');
    }
    const durationSeconds = this.validateDuration(input.durationSeconds);
    this.validateAvailableBalanceForStake(input.stakeUsd);
    const blocked = settings.lossLimitBlock();
    if (blocked) {
      throw new ClassicOptionError(blocked, 'LOSS_LIMIT');
    }
    const tick = this.requireFreshTick('open');

    const stake = roundMoney(input.stakeUsd);
    const openedAt = new Date();
    const expiresAt = new Date(openedAt.getTime() + durationSeconds * 1000);
    const base = input.asset.split('/')[0] ?? input.asset;

    const position = getDb().transaction((): Position => {
      const created = createPosition({
        symbol: `${base}-${openedAt.toISOString().slice(0, 10)}-${Math.round(tick.price)}-${input.side === 'CALL' ? 'C' : 'P'}`,
        side: input.side,
        strikePrice: tick.price,
        expiry: expiresAt.toISOString().slice(0, 10),
        quantity: 1,
        entryPremium: stake,
        stakeUsd: stake,
        optionType: 'CLASSIC',
        openedAt: openedAt.toISOString(),
        durationSeconds,
        expiresAt: expiresAt.toISOString(),
        source: input.source ?? 'MANUAL',
      });
      this.lockStakeForPosition(
        stake,
        `classic option #${created.id} ${input.side} ${durationSeconds}s stake locked`,
        created.id,
      );
      return created;
    })();

    publishEvent('options', { action: 'OPENED', position });
    publishEvent('account', getAccount());
    logger.info(
      { positionId: position.id, side: input.side, stake, duration: durationSeconds },
      'classic option opened',
    );
    return position;
  }


  /* ------------------------------ settlement ------------------------------ */

  /**
   * Settles every expired OPEN position; called by the 1s scheduler.
   * Within the grace period a stale price waits; after it, the stake is
   * refunded and a risk event recorded.
   */
  settleDueOptions(): number {
    const nowMs = Date.now();
    let settled = 0;
    for (const position of listPositions('OPEN')) {
      const expiresAtMs = position.expiresAt ? new Date(position.expiresAt).getTime() : Number.NaN;
      if (!Number.isFinite(expiresAtMs) || nowMs < expiresAtMs) {
        continue;
      }
      const tick = this.feed.getLatestTick();
      const ageMs = tick ? nowMs - new Date(tick.timestamp).getTime() : Number.POSITIVE_INFINITY;
      const stale = !tick || ageMs > config.OPTION_MAX_PRICE_STALE_MS;
      const withinGrace = nowMs - expiresAtMs < config.OPTION_SETTLEMENT_GRACE_MS;
      if (stale && withinGrace) {
        continue; // wait briefly for a fresh price
      }
      try {
        if (this.settleExpiredClassicOption(position, stale || !tick ? null : tick.price)) {
          settled += 1;
        }
      } catch (err) {
        logger.error({ err, positionId: position.id }, 'classic settlement failed');
      }
    }
    return settled;
  }

  /**
   * Settles one expired position atomically: claim → unlock exact stake →
   * credit win/loss/refund → ledger row → close position. `price === null`
   * means no valid market price within the grace period → refund + risk
   * event. Returns false when another caller already claimed it.
   */
  settleExpiredClassicOption(position: Position, price: number | null): boolean {
    const outcome = getDb().transaction((): Position | null => {
      if (!claimPositionForSettlement(position.id)) {
        return null;
      }
      return price === null
        ? this.applyRefund(position, 'no valid market price within the grace period', true)
        : this.applySettlement(position, price);
    })();
    if (!outcome) {
      return false;
    }
    publishEvent('options', {
      action: outcome.settlementStatus === 'REFUNDED' ? 'REFUNDED' : 'SETTLED',
      position: outcome,
    });
    publishEvent('account', getAccount());
    return true;
  }

  /**
   * Risk-engine emergency close: refunds the exact stake of every OPEN
   * classic position (no win/loss is booked). Used when a loss limit fires.
   */
  refundAllOpenPositions(reason: string): number {
    let count = 0;
    for (const position of listPositions('OPEN')) {
      const refunded = getDb().transaction((): Position | null =>
        claimPositionForSettlement(position.id) ? this.applyRefund(position, reason, false) : null,
      )();
      if (refunded) {
        count += 1;
        publishEvent('options', { action: 'REFUNDED', position: refunded });
        publishEvent('trade', { action: 'CLOSED', position: refunded });
      }
    }
    if (count > 0) {
      logRiskEvent({
        type: 'CLASSIC_EMERGENCY_REFUND',
        message: `${count} open classic option(s) refunded: ${reason}`,
        equityAtTrigger: getAccount().equity,
      });
      publishEvent('account', getAccount());
    }
    return count;
  }


  private applySettlement(position: Position, price: number): Position | null {
    const account = getAccount();
    const stake = positionStake(position);
    const isFlat = Math.abs(price - position.strikePrice) < 1e-9;
    const isWin =
      position.side === 'CALL' ? price > position.strikePrice : price < position.strikePrice;
    const result = isFlat ? 'REFUND' : isWin ? 'WIN' : 'LOSE';
    const profit = roundMoney(stake * OPTION_PAYOUT_RATIO);
    const settledAtIso = new Date().toISOString();
    const move = `${position.side} ${position.strikePrice} → ${price}`;

    if (result === 'WIN') {
      this.unlockStakeForPosition(position, roundMoney(stake + profit));
      logTransaction({
        type: 'OPTION_SETTLE_WIN',
        amount: roundMoney(stake + profit),
        currency: account.baseCurrency,
        description: `classic option #${position.id} WIN: ${move}`,
        positionId: position.id,
      });
    } else if (result === 'LOSE') {
      this.unlockStakeForPosition(position, 0);
      logTransaction({
        type: 'OPTION_SETTLE_LOSS',
        amount: -stake,
        currency: account.baseCurrency,
        description: `classic option #${position.id} LOSE: ${move}`,
        positionId: position.id,
      });
    } else {
      this.unlockStakeForPosition(position, stake);
      logTransaction({
        type: 'OPTION_SETTLE_REFUND',
        amount: stake,
        currency: account.baseCurrency,
        description: `classic option #${position.id} REFUND: price unchanged at ${price}`,
        positionId: position.id,
      });
    }

    const settled = updatePosition(position.id, {
      status: 'CLOSED',
      exitPremium: price,
      realizedPnl: result === 'WIN' ? profit : result === 'LOSE' ? -stake : 0,
      closedAt: settledAtIso,
      settledAt: settledAtIso,
      settlementPrice: price,
      settlementStatus: result === 'REFUND' ? 'REFUNDED' : 'SETTLED',
      settlementReason: `expired: ${result} at market price ${price}`,
    });
    logRiskEvent({
      type: 'OPTION_EXPIRED_SETTLED',
      message: `classic option #${position.id} expired: ${result} at ${price}`,
      equityAtTrigger: getAccount().equity,
    });
    return settled;
  }

  private applyRefund(position: Position, reason: string, staleRefund: boolean): Position | null {
    const account = getAccount();
    const stake = positionStake(position);
    const nowIso = new Date().toISOString();
    this.unlockStakeForPosition(position, stake);
    logTransaction({
      type: 'OPTION_SETTLE_REFUND',
      amount: stake,
      currency: account.baseCurrency,
      description: `classic option #${position.id} REFUND: ${reason}`,
      positionId: position.id,
    });
    const refunded = updatePosition(position.id, {
      status: 'CLOSED',
      exitPremium: position.entryPremium,
      realizedPnl: 0,
      closedAt: nowIso,
      settledAt: nowIso,
      settlementStatus: 'REFUNDED',
      settlementReason: reason,
    });
    if (staleRefund) {
      logRiskEvent({
        type: 'OPTION_EXPIRED_REFUNDED',
        message: `classic option #${position.id} refunded: ${reason}`,
        equityAtTrigger: getAccount().equity,
      });
    }
    return refunded;
  }

  /** True when the latest tick is recent enough to trade/settle on. */
  isMarketDataFresh(): boolean {
    const tick = this.feed.getLatestTick();
    return (
      tick !== null &&
      Date.now() - new Date(tick.timestamp).getTime() <= config.OPTION_MAX_PRICE_STALE_MS
    );
  }

  private requireFreshTick(context: string): { price: number; source: string } {
    const tick = this.feed.getLatestTick();
    if (!tick) {
      throw new ClassicOptionError('No market price available yet — try again shortly.', 'MARKET_DATA');
    }
    const ageMs = Date.now() - new Date(tick.timestamp).getTime();
    if (ageMs > config.OPTION_MAX_PRICE_STALE_MS) {
      logRiskEvent({
        type: 'OPTION_SETTLEMENT_PRICE_STALE',
        message: `option ${context} blocked: latest price is ${ageMs}ms old`,
        equityAtTrigger: getAccount().equity,
      });
      throw new ClassicOptionError('Market data stale — try again shortly.', 'MARKET_DATA');
    }
    return { price: tick.price, source: tick.source };
  }
}

export const optionService = new OptionService();
