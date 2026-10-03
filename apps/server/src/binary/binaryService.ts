import { roundMoney } from '@aioption/shared';
import type { BinaryContract, BinaryQuote, BinarySummary, PriceTick } from '@aioption/shared';

import { config } from '../config.js';
import {
  getAccount,
  logRiskEvent,
  logTransaction,
  updateAccount,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import { logger } from '../logger.js';
import { getBinarySessionService } from './binarySessionService.js';
import {
  binaryNetPnl,
  countOpenBinaryContracts,
  createBinaryContract,
  listDueBinaryContracts,
  listOpenBinaryContracts,
  listSettledBinaryContracts,
  logBinaryEvent,
  markBinaryContractError,
  settleBinaryContract,
} from './binaryRepository.js';
import type { BinaryPriceFeed, OpenBinaryInput } from './binaryTypes.js';

const round = (value: number): number => roundMoney(value);

/** Static risk warnings attached to quotes. */
export const BINARY_WARNINGS = [
  'Short-duration binary options are extremely high risk and may result in rapid losses.',
  'Not investment advice. You can lose your entire stake.',
];

/**
 * Short-duration binary options, settled INTERNALLY against the backend
 * market price feed. No on-chain settlement, no real exchange orders —
 * deposits/withdrawals stay on Tron USDC (TRC20) as defined in Phase 6.1.
 */
export class BinaryService {
  constructor(private readonly feed: BinaryPriceFeed) {}

  getConfig() {
    return {
      enabled: config.BINARY_ENABLED,
      liveTradingEnabled: config.BINARY_LIVE_TRADING_ENABLED,
      allowedDurationsSeconds: config.BINARY_ALLOWED_DURATIONS_SECONDS,
      allowedPayoutRatios: config.BINARY_ALLOWED_PAYOUT_RATIOS,
      minStakeUsd: config.BINARY_MIN_STAKE_USD,
      maxStakeUsd: config.BINARY_MAX_STAKE_USD,
      defaultStakeUsd: config.BINARY_DEFAULT_STAKE_USD,
      maxOpenContracts: config.BINARY_MAX_OPEN_CONTRACTS,
      maxPriceStaleMs: config.BINARY_MAX_PRICE_STALE_MS,
      settlementSource: config.BINARY_SETTLEMENT_SOURCE,
    };
  }

  /** Quote preview for the ticket. Throws on invalid input. */
  getQuote(stakeUsd: number, durationSeconds: number, payoutRatio: number): BinaryQuote {
    this.validateInput({
      asset: 'BTC/USDC',
      direction: 'UP',
      stakeUsd,
      durationSeconds,
      payoutRatio,
    });
    const tick = this.requireFreshTick('quote');
    return {
      stake: round(stakeUsd),
      payoutRatio,
      potentialProfit: round(stakeUsd * payoutRatio),
      totalReturnIfWin: round(stakeUsd + stakeUsd * payoutRatio),
      totalLossIfLose: round(stakeUsd),
      currentPrice: tick.price,
      warnings: BINARY_WARNINGS,
    };
  }

  /** Opens a binary contract: validates, risk-checks, locks stake, persists. */
  openBinaryContract(input: OpenBinaryInput): BinaryContract {
    this.validateInput(input);

    if (!config.BINARY_ENABLED) {
      throw new Error('binary options are disabled');
    }

    const account = getAccount();
    if (!account.tradingEnabled) {
      throw new Error('trading is disabled — start trading first');
    }

    // Loss floor (same rule as the classic risk engine).
    if (account.startingEquity > 0) {
      const floor = account.startingEquity * (1 - account.lossLimitPercent / 100);
      if (account.equity <= floor) {
        logRiskEvent({
          type: 'BINARY_LOSS_LIMIT_BLOCK',
          message: `binary open blocked: equity ${round(account.equity)} <= loss floor ${round(floor)}`,
          equityAtTrigger: account.equity,
        });
        throw new Error('loss limit reached — new binary contracts are blocked');
      }
    }

    // Binary session gain limit (Phase 6.5): blocks manual opens too.
    if (getBinarySessionService().isGainLimitReached()) {
      logRiskEvent({
        type: 'BINARY_SESSION_GAIN_LIMIT_BLOCK',
        message: 'binary open blocked: session gain limit reached',
        equityAtTrigger: account.equity,
      });
      throw new Error(
        'binary session gain limit reached — new binary trades are blocked (reset the session to continue)',
      );
    }

    if (input.stakeUsd > account.cashBalance + 1e-9) {
      throw new Error(
        `insufficient balance: stake ${input.stakeUsd} exceeds available ${round(account.cashBalance)}`,
      );
    }

    // 0 = unlimited (default): no cap on the number of binary trades.
    if (config.BINARY_MAX_OPEN_CONTRACTS > 0 && countOpenBinaryContracts() >= config.BINARY_MAX_OPEN_CONTRACTS) {
      logRiskEvent({
        type: 'BINARY_MAX_OPEN_CONTRACTS_REACHED',
        message: `binary open blocked: ${config.BINARY_MAX_OPEN_CONTRACTS} open contracts reached`,
        equityAtTrigger: account.equity,
      });
      throw new Error(`maximum of ${config.BINARY_MAX_OPEN_CONTRACTS} open binary contracts reached`);
    }

    const tick = this.requireFreshTick('open');
    const source = input.source ?? 'MANUAL_BINARY';
    const isAi = source === 'AI_BINARY';
    const openedAt = new Date();
    const openedAtIso = openedAt.toISOString();
    const expiresAtIso = new Date(openedAt.getTime() + input.durationSeconds * 1000).toISOString();
    const profit = round(input.stakeUsd * input.payoutRatio);

    // Lock the stake: cash → locked.
    updateAccount({
      cashBalance: round(account.cashBalance - input.stakeUsd),
      lockedBalance: round(account.lockedBalance + input.stakeUsd),
    });
    logTransaction({
      type: isAi ? 'AI_BINARY_STAKE_LOCKED' : 'BINARY_STAKE_LOCKED',
      amount: round(-input.stakeUsd),
      currency: account.baseCurrency,
      description: `${isAi ? 'AI binary' : 'binary'} ${input.direction} ${input.durationSeconds}s stake locked`,
      positionId: null,
    });

    const contract = createBinaryContract({
      asset: input.asset,
      direction: input.direction,
      stakeUsd: round(input.stakeUsd),
      payoutRatio: input.payoutRatio,
      potentialProfitUsd: profit,
      totalReturnIfWinUsd: round(input.stakeUsd + profit),
      entryPrice: tick.price,
      openedAt: openedAtIso,
      expiresAt: expiresAtIso,
      marketDataSource: tick.source,
      source,
    });
    logBinaryEvent(contract.id, 'OPENED', `entry ${tick.price} (${tick.source})`);
    publishEvent('binary', { action: 'OPENED', contract });
    publishEvent('account', getAccount());
    logger.info(
      { contractId: contract.id, direction: input.direction, stake: contract.stakeUsd },
      'binary contract opened',
    );
    return contract;
  }

  /** Settles every contract whose expiry has been reached (atomic, idempotent). */
  settleDueContracts(nowIso = new Date().toISOString()): number {
    const due = listDueBinaryContracts(nowIso);
    let settled = 0;
    for (const contract of due) {
      if (this.settleOne(contract, nowIso)) {
        settled++;
      }
    }
    return settled;
  }

  /** Latest feed price (0 if none yet) — used for live contract status. */
  currentPrice(): number {
    return this.feed.getLatestTick()?.price ?? 0;
  }

  getOpenContracts(): BinaryContract[] {
    return listOpenBinaryContracts();
  }

  getHistory(limit = 50): BinaryContract[] {
    return listSettledBinaryContracts(limit);
  }

  getSummary(): BinarySummary {
    const rows = listSettledBinaryContracts(10_000);
    let wins = 0;
    let losses = 0;
    let refunds = 0;
    for (const contract of rows) {
      if (contract.result === 'WIN') wins++;
      else if (contract.result === 'LOSE') losses++;
      else if (contract.result === 'REFUND') refunds++;
    }
    return {
      wins,
      losses,
      refunds,
      netPnlUsd: round(binaryNetPnl()),
      openCount: countOpenBinaryContracts(),
    };
  }

  /* -------------------------------- internal -------------------------------- */

  private validateInput(input: OpenBinaryInput): void {
    if (input.asset !== 'BTC/USDC') {
      throw new Error('only BTC/USDC binary contracts are supported');
    }
    if (input.direction !== 'UP' && input.direction !== 'DOWN') {
      throw new Error('direction must be UP or DOWN');
    }
    if (!Number.isFinite(input.stakeUsd) || input.stakeUsd < config.BINARY_MIN_STAKE_USD) {
      throw new Error(`stake must be at least ${config.BINARY_MIN_STAKE_USD} USDC`);
    }
    if (input.stakeUsd > config.BINARY_MAX_STAKE_USD) {
      throw new Error(`stake must be at most ${config.BINARY_MAX_STAKE_USD} USDC`);
    }
    if (!config.BINARY_ALLOWED_DURATIONS_SECONDS.includes(input.durationSeconds)) {
      throw new Error(
        `duration must be one of ${config.BINARY_ALLOWED_DURATIONS_SECONDS.join(', ')} seconds`,
      );
    }
    if (!config.BINARY_ALLOWED_PAYOUT_RATIOS.includes(input.payoutRatio)) {
      throw new Error(
        `payout ratio must be one of ${config.BINARY_ALLOWED_PAYOUT_RATIOS.join(', ')}`,
      );
    }
  }

  private requireFreshTick(context: string): PriceTick {
    const tick = this.feed.getLatestTick();
    if (!tick) {
      throw new Error(`no market price available to ${context} a contract`);
    }
    const ageMs = Date.now() - new Date(tick.timestamp).getTime();
    if (ageMs > config.BINARY_MAX_PRICE_STALE_MS) {
      logRiskEvent({
        type: 'BINARY_MARKET_DATA_STALE',
        message: `binary ${context} blocked: latest price is ${ageMs}ms old (limit ${config.BINARY_MAX_PRICE_STALE_MS}ms)`,
        equityAtTrigger: getAccount().equity,
      });
      throw new Error('market data is stale — try again shortly');
    }
    return tick;
  }

  private settleOne(contract: BinaryContract, nowIso: string): boolean {
    // Wait for the first tick at/after expiry.
    const tick = this.feed.getTickAtOrAfter(contract.expiresAt);
    if (!tick) {
      const waitedMs = new Date(nowIso).getTime() - new Date(contract.expiresAt).getTime();
      if (waitedMs > config.BINARY_MAX_PRICE_STALE_MS) {
        this.failWithRefund(contract, 'no market price at/after expiry within the stale window');
        return true;
      }
      return false; // retry on the next scheduler tick
    }

    const account = getAccount();
    const result = this.resultOf(contract, tick.price);
    const isAi = contract.source === 'AI_BINARY';

    if (result === 'WIN') {
      updateAccount({
        cashBalance: round(account.cashBalance + contract.totalReturnIfWinUsd),
        lockedBalance: round(account.lockedBalance - contract.stakeUsd),
        equity: round(account.equity + contract.potentialProfitUsd),
      });
      logTransaction({
        type: isAi ? 'AI_BINARY_WIN' : 'BINARY_WIN',
        amount: contract.totalReturnIfWinUsd,
        currency: account.baseCurrency,
        description: `${isAi ? 'AI binary' : 'binary'} WIN #${contract.id}: ${contract.direction} ${contract.entryPrice} → ${tick.price}`,
        positionId: null,
      });
    } else if (result === 'LOSE') {
      updateAccount({
        lockedBalance: round(account.lockedBalance - contract.stakeUsd),
        equity: round(account.equity - contract.stakeUsd),
      });
      logTransaction({
        type: isAi ? 'AI_BINARY_LOSS' : 'BINARY_LOSS',
        amount: round(-contract.stakeUsd),
        currency: account.baseCurrency,
        description: `${isAi ? 'AI binary' : 'binary'} LOSE #${contract.id}: ${contract.direction} ${contract.entryPrice} → ${tick.price}`,
        positionId: null,
      });
    } else {
      updateAccount({
        cashBalance: round(account.cashBalance + contract.stakeUsd),
        lockedBalance: round(account.lockedBalance - contract.stakeUsd),
      });
      logTransaction({
        type: isAi ? 'AI_BINARY_REFUND' : 'BINARY_REFUND',
        amount: contract.stakeUsd,
        currency: account.baseCurrency,
        description: `${isAi ? 'AI binary' : 'binary'} REFUND #${contract.id}: price unchanged at ${tick.price}`,
        positionId: null,
      });
    }

    const settled = settleBinaryContract(contract.id, {
      status: 'SETTLED',
      result,
      settlementPrice: tick.price,
      settledAt: new Date().toISOString(),
      notes: `source=${tick.source}`,
    });
    if (!settled) {
      return false; // already settled by a concurrent tick — ignore
    }
    logBinaryEvent(
      contract.id,
      'SETTLED',
      `entry=${contract.entryPrice} settlement=${tick.price} source=${tick.source} result=${result}`,
    );
    publishEvent('binary', { action: 'SETTLED', contract: settled });
    publishEvent('account', getAccount());
    logger.info(
      {
        contractId: contract.id,
        entryPrice: contract.entryPrice,
        settlementPrice: tick.price,
        source: tick.source,
        result,
      },
      'binary contract settled',
    );
    return true;
  }

  private failWithRefund(contract: BinaryContract, reason: string): void {
    const updated = markBinaryContractError(contract.id, reason);
    if (!updated) {
      return;
    }
    const account = getAccount();
    updateAccount({
      cashBalance: round(account.cashBalance + contract.stakeUsd),
      lockedBalance: round(account.lockedBalance - contract.stakeUsd),
    });
    logTransaction({
      type: 'BINARY_REFUND',
      amount: contract.stakeUsd,
      currency: account.baseCurrency,
      description: `binary refund #${contract.id}: ${reason}`,
      positionId: null,
    });
    logRiskEvent({
      type: 'BINARY_MARKET_DATA_STALE',
      message: `binary #${contract.id}: ${reason} — stake refunded`,
      equityAtTrigger: account.equity,
    });
    logBinaryEvent(contract.id, 'ERROR', reason);
    publishEvent('binary', { action: 'SETTLED', contract: updated });
    publishEvent('account', getAccount());
  }

  private resultOf(contract: BinaryContract, settlementPrice: number): 'WIN' | 'LOSE' | 'REFUND' {
    if (settlementPrice === contract.entryPrice) {
      return 'REFUND';
    }
    const up = settlementPrice > contract.entryPrice;
    return up === (contract.direction === 'UP') ? 'WIN' : 'LOSE';
  }
}

/** Singleton wiring the live market feed. */
export const binaryService = new BinaryService(liveMarket);
