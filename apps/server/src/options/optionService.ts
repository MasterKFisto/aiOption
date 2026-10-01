import { roundMoney } from '@aioption/shared';
import type { OptionConfig, Position } from '@aioption/shared';

import type { BinaryPriceFeed } from '../binary/binaryTypes.js';
import { config } from '../config.js';
import {
  claimPositionForSettlement,
  createPosition,
  getAccount,
  listPositions,
  logRiskEvent,
  logTransaction,
  updateAccount,
  updatePosition,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import { logger } from '../logger.js';

/** Payout ratio applied to classic option wins (fraction of the stake). */
const OPTION_PAYOUT_RATIO = 0.8;

export interface OpenOptionInput {
  asset: string;
  side: 'CALL' | 'PUT';
  stakeUsd: number;
  durationSeconds: number;
  source?: string;
}

/**
 * Classic short-duration options: manual open + automatic settlement at expiry
 * against the live market price. Settlement reuses the wallet/ledger model of
 * the binary service (stake locked, win/lose/refund at expiry).
 */
export class OptionService {
  constructor(private readonly feed: BinaryPriceFeed = liveMarket) {}

  getConfig(): OptionConfig {
    return {
      minStakeUsd: config.MIN_OPTION_STAKE_USD,
      maxStakeUsd: config.MAX_OPTION_STAKE_USD,
      defaultStakeUsd: config.DEFAULT_OPTION_STAKE_USD,
      allowedDurationsSeconds: config.OPTION_ALLOWED_DURATIONS_SECONDS,
      defaultDurationSeconds: config.OPTION_DEFAULT_DURATION_SECONDS,
      maxDurationSeconds: config.OPTION_MAX_DURATION_SECONDS,
    };
  }

  openOption(input: OpenOptionInput): Position {
    const account = getAccount();
    if (!account.tradingEnabled) {
      throw new Error('trading is disabled — start trading first');
    }
    if (input.stakeUsd < config.MIN_OPTION_STAKE_USD) {
      throw new Error(`stake must be at least ${config.MIN_OPTION_STAKE_USD} USDC`);
    }
    const maxStake = account.maxOptionStakeUsd;
    if (input.stakeUsd > maxStake) {
      logRiskEvent({
        type: 'MAX_STAKE_LIMIT_REJECTED',
        message: `option open rejected: stake ${input.stakeUsd} exceeds the ${maxStake} USDC maximum`,
        equityAtTrigger: account.equity,
      });
      throw new Error(`stake exceeds the ${maxStake} USDC maximum`);
    }
    if (!config.OPTION_ALLOWED_DURATIONS_SECONDS.includes(input.durationSeconds)) {
      throw new Error(
        `duration must be one of ${config.OPTION_ALLOWED_DURATIONS_SECONDS.join(', ')} seconds`,
      );
    }
    if (input.durationSeconds > config.OPTION_MAX_DURATION_SECONDS) {
      throw new Error(`duration exceeds the ${config.OPTION_MAX_DURATION_SECONDS}s maximum`);
    }
    if (input.stakeUsd > account.cashBalance + 1e-9) {
      throw new Error(
        `insufficient balance: stake ${input.stakeUsd} exceeds available ${roundMoney(account.cashBalance)}`,
      );
    }
    // Global loss floor (same rule as the classic risk engine).
    if (account.startingEquity > 0) {
      const floor = account.startingEquity * (1 - account.lossLimitPercent / 100);
      if (account.equity <= floor) {
        throw new Error('loss limit reached — new options are blocked');
      }
    }

    const tick = this.requireFreshTick('open');
    const openedAt = new Date();
    const expiresAt = new Date(openedAt.getTime() + input.durationSeconds * 1000);

    updateAccount({
      cashBalance: roundMoney(account.cashBalance - input.stakeUsd),
      lockedBalance: roundMoney(account.lockedBalance + input.stakeUsd),
    });
    logTransaction({
      type: 'OPTION_STAKE_LOCKED',
      amount: roundMoney(-input.stakeUsd),
      currency: account.baseCurrency,
      description: `classic option ${input.side} ${input.durationSeconds}s stake locked`,
      positionId: null,
    });

    const base = input.asset.split('/')[0] ?? input.asset;
    const position = createPosition({
      symbol: `${base}-${openedAt.toISOString().slice(0, 10)}-${Math.round(tick.price)}-${input.side === 'CALL' ? 'C' : 'P'}`,
      side: input.side,
      strikePrice: tick.price,
      expiry: expiresAt.toISOString().slice(0, 10),
      quantity: 1,
      entryPremium: input.stakeUsd,
      openedAt: openedAt.toISOString(),
      durationSeconds: input.durationSeconds,
      expiresAt: expiresAt.toISOString(),
      source: input.source ?? 'MANUAL',
    });

    publishEvent('options', { action: 'OPENED', position });
    publishEvent('account', getAccount());
    logger.info(
      { positionId: position.id, side: input.side, duration: input.durationSeconds },
      'classic option opened',
    );
    return position;
  }

  /** Settles every expired OPEN position; called by the 1s scheduler. */
  settleDueOptions(): void {
    const nowMs = Date.now();
    for (const position of listPositions('OPEN')) {
      if (!position.expiresAt) {
        continue;
      }
      const expiresAtMs = new Date(position.expiresAt).getTime();
      if (nowMs < expiresAtMs) {
        continue;
      }
      const withinGrace = nowMs - expiresAtMs < config.OPTION_SETTLEMENT_GRACE_MS;
      const tick = this.feed.getLatestTick();
      const ageMs = tick ? nowMs - new Date(tick.timestamp).getTime() : Infinity;
      const stale = !tick || ageMs > config.OPTION_MAX_PRICE_STALE_MS;
      if (stale && withinGrace) {
        continue; // wait briefly for a fresh price
      }
      // Atomic claim: only one settlement attempt can ever pay a position.
      if (!claimPositionForSettlement(position.id)) {
        continue;
      }
      if (stale) {
        this.refund(position, 'no fresh market price within the grace period');
        continue;
      }
      this.settle(position, tick.price);
    }
  }


  private settle(position: Position, price: number): void {
    const account = getAccount();
    const stake = position.entryPremium * position.quantity;
    const isWin =
      position.side === 'CALL' ? price > position.strikePrice : price < position.strikePrice;
    const isFlat = Math.abs(price - position.strikePrice) < 1e-12;
    const result = isFlat ? 'REFUND' : isWin ? 'WIN' : 'LOSE';
    const profit = roundMoney(stake * OPTION_PAYOUT_RATIO);
    const settledAtIso = new Date().toISOString();

    if (result === 'WIN') {
      updateAccount({
        cashBalance: roundMoney(account.cashBalance + stake + profit),
        lockedBalance: roundMoney(account.lockedBalance - stake),
        equity: roundMoney(account.equity + profit),
      });
      logTransaction({
        type: 'OPTION_SETTLE_WIN',
        amount: roundMoney(stake + profit),
        currency: account.baseCurrency,
        description: `classic option #${position.id} WIN: ${position.side} ${position.strikePrice} → ${price}`,
        positionId: position.id,
      });
    } else if (result === 'LOSE') {
      updateAccount({
        lockedBalance: roundMoney(account.lockedBalance - stake),
        equity: roundMoney(account.equity - stake),
      });
      logTransaction({
        type: 'OPTION_SETTLE_LOSS',
        amount: roundMoney(-stake),
        currency: account.baseCurrency,
        description: `classic option #${position.id} LOSE: ${position.side} ${position.strikePrice} → ${price}`,
        positionId: position.id,
      });
    } else {
      updateAccount({
        cashBalance: roundMoney(account.cashBalance + stake),
        lockedBalance: roundMoney(account.lockedBalance - stake),
      });
      logTransaction({
        type: 'OPTION_SETTLE_REFUND',
        amount: roundMoney(stake),
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
      settlementStatus: result === 'WIN' || result === 'LOSE' ? 'SETTLED' : 'REFUNDED',
      settlementReason: `expired and settled at market price ${price}`,
    });
    logRiskEvent({
      type: 'OPTION_EXPIRED_SETTLED',
      message: `classic option #${position.id} expired: ${result} at ${price}`,
      equityAtTrigger: getAccount().equity,
    });
    publishEvent('options', { action: 'SETTLED', position: settled });
    publishEvent('account', getAccount());
  }

  private refund(position: Position, reason: string): void {
    const account = getAccount();
    const stake = position.entryPremium * position.quantity;
    updateAccount({
      cashBalance: roundMoney(account.cashBalance + stake),
      lockedBalance: roundMoney(account.lockedBalance - stake),
    });
    logTransaction({
      type: 'OPTION_SETTLE_REFUND',
      amount: roundMoney(stake),
      currency: account.baseCurrency,
      description: `classic option #${position.id} REFUND: ${reason}`,
      positionId: position.id,
    });
    const settled = updatePosition(position.id, {
      status: 'CLOSED',
      realizedPnl: 0,
      closedAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
      settlementStatus: 'REFUNDED',
      settlementReason: reason,
    });
    logRiskEvent({
      type: 'OPTION_EXPIRED_REFUNDED',
      message: `classic option #${position.id} refunded: ${reason}`,
      equityAtTrigger: getAccount().equity,
    });
    publishEvent('options', { action: 'REFUNDED', position: settled });
    publishEvent('account', getAccount());
  }

  private requireFreshTick(context: string): { price: number; source: string } {
    const tick = this.feed.getLatestTick();
    if (!tick) {
      throw new Error('no market price available yet');
    }
    const ageMs = Date.now() - new Date(tick.timestamp).getTime();
    if (ageMs > config.OPTION_MAX_PRICE_STALE_MS) {
      logRiskEvent({
        type: 'OPTION_SETTLEMENT_PRICE_STALE',
        message: `option ${context} blocked: latest price is ${ageMs}ms old`,
        equityAtTrigger: getAccount().equity,
      });
      throw new Error('market data stale — try again shortly');
    }
    return { price: tick.price, source: tick.source };
  }
}

export const optionService = new OptionService();
