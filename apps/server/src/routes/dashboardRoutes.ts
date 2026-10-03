import type { FastifyInstance } from 'fastify';

import { roundMoney } from '@aioption/shared';
import type { AccountSummary } from '@aioption/shared';

import { binaryNetPnl } from '../binary/binaryRepository.js';
import { getBinarySessionService } from '../binary/binarySessionService.js';
import { latestAiSessionProfit } from '../binary-ai/binaryAiRepository.js';
import {
  getAccount,
  listAiDecisions,
  listPositions,
  listRiskEvents,
  positionStake,
} from '../db/repositories.js';
import { z } from 'zod';

import { listOpenBinaryContracts } from '../binary/binaryRepository.js';
import { setAppSetting } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import { tradingLoop } from '../scheduler/tradingLoop.js';
import {
  BINARY_ESTIMATE_SETTING_KEY,
  CLASSIC_PAYOUT_RATIO,
  binaryLiveView,
  binaryUnrealizedMode,
  classicUnrealizedPnl,
  portfolioUnrealized,
} from '../valuation/unrealizedPnl.js';

/** Computes the Phase 6.5 unified account-block fields. */
function unifiedAccountSummary(): AccountSummary {
  const account = getAccount();
  const closed = listPositions('CLOSED');
  const realizedPnl = roundMoney(
    closed.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0),
  );
  const lossLimitFloorUsd = roundMoney(
    account.startingEquity * (1 - account.lossLimitPercent / 100),
  );
  const dailyLossRemainingUsd = roundMoney(Math.max(0, account.equity - lossLimitFloorUsd));
  const sessionStats = getBinarySessionService().getStats();
  // Phase 6.5.3: live, bounded classic mark-to-market; binary kept separate.
  const unrealized = portfolioUnrealized(liveMarket.getLatestTick()?.price ?? 0);
  return {
    account,
    realizedPnl,
    binaryNetPnl: roundMoney(binaryNetPnl()),
    unrealizedPnl: unrealized.unrealizedPnl,
    availableBalance: roundMoney(account.cashBalance),
    lockedBalance: roundMoney(account.lockedBalance),
    totalEquity: roundMoney(account.equity),
    openClassicUnrealizedPnl: unrealized.openClassicUnrealizedPnl,
    openBinaryExposure: unrealized.openBinaryExposure,
    openBinaryCount: unrealized.openBinaryCount,
    estimatedBinaryUnrealizedPnl: unrealized.estimatedBinaryUnrealizedPnl,
    binaryUnrealizedMode: unrealized.binaryUnrealizedMode,
    loopRunning: tradingLoop.isRunning,
    dailyLossLimitPercent: account.lossLimitPercent,
    dailyLossRemainingUsd,
    lossLimitFloorUsd,
    binarySessionGainUsd: roundMoney(sessionStats.combinedNetGain),
    binarySessionGainLimitUsd: sessionStats.gainLimitEnabled ? sessionStats.maxSessionGainUsdt : 0,
    binarySessionGainRemainingUsd: roundMoney(sessionStats.remainingSessionGain),
    binarySessionGainLimitReached: sessionStats.gainLimitReached,
    aiBinarySessionProfitUsd: roundMoney(latestAiSessionProfit()),
  };
}

/**
 * Read-only dashboard endpoints for the web frontend.
 *
 * Registered with prefix /api:
 *   GET /api/account/summary
 *   GET /api/account
 *   GET /api/positions?status=OPEN|CLOSED
 *   GET /api/ai/decisions?limit=N
 *   GET /api/risk-events?limit=N
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/account/summary', async (): Promise<AccountSummary> => unifiedAccountSummary());

  // Alias requested by the spec: latest equity and balances.
  app.get('/account', async (): Promise<AccountSummary> => unifiedAccountSummary());

  app.get('/positions', async (request) => {
    const { status, include } = request.query as { status?: string; include?: string };
    const positions = status === 'OPEN' || status === 'CLOSED' ? listPositions(status) : listPositions();
    // Enrich with expiry/countdown/current-price data for the UI.
    const tick = liveMarket.getLatestTick();
    const currentPrice = tick?.price ?? 0;
    const nowMs = Date.now();
    const classic = positions.map((position) => {
      // Exact locked stake (Phase 6.5.1), never premium × qty + fees.
      const stake = positionStake(position);
      const expiresAtMs = position.expiresAt ? new Date(position.expiresAt).getTime() : null;
      const open = position.status === 'OPEN';
      const timeRemainingMs = open && expiresAtMs ? Math.max(expiresAtMs - nowMs, 0) : 0;
      return {
        ...position,
        // Phase 6.5.3 unified fields.
        positionType: 'CLASSIC' as const,
        lockedStake: open ? stake : 0,
        timeRemainingMs,
        currentStatus: null,
        stakeUsd: stake,
        secondsRemaining: Math.ceil(timeRemainingMs / 1000),
        currentPrice,
        // Bounded live estimate (was: final win/loss outcome — misleading).
        unrealizedPnl: classicUnrealizedPnl(position, currentPrice, nowMs),
        potentialProfitUsd: roundMoney(stake * CLASSIC_PAYOUT_RATIO),
        potentialLossUsd: stake,
      };
    });
    if (include !== 'binary' || status === 'CLOSED') {
      return classic;
    }
    // ?include=binary → also return OPEN binary contracts in the unified shape.
    const mode = binaryUnrealizedMode();
    const binary = listOpenBinaryContracts().map((contract) => {
      const live = binaryLiveView(contract, currentPrice, mode, nowMs);
      return {
        positionType: 'BINARY' as const,
        id: contract.id,
        side: contract.direction,
        status: contract.status,
        lockedStake: roundMoney(contract.stakeUsd),
        entryPrice: contract.entryPrice,
        currentPrice,
        // Conservative: binary never contributes to unrealized PnL.
        unrealizedPnl: 0,
        estimatedUnrealizedPnl: live.estimatedUnrealizedPnl,
        currentStatus: live.currentStatus,
        timeRemainingMs: live.timeRemainingMs,
        expiresAt: contract.expiresAt,
        potentialProfitUsd: live.potentialProfit,
        potentialLossUsd: live.potentialLoss,
        source: contract.source,
      };
    });
    return [...classic, ...binary];
  });

  // Phase 6.5.3: binary unrealized display mode (stored in app_settings).
  app.get('/settings/binary-unrealized', async () => ({ mode: binaryUnrealizedMode() }));

  app.put('/settings/binary-unrealized', async (request, reply) => {
    const parsed = z
      .object({ showEstimated: z.boolean() })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    setAppSetting(BINARY_ESTIMATE_SETTING_KEY, parsed.data.showEstimated ? 'true' : 'false');
    publishEvent('account', getAccount());
    return { mode: binaryUnrealizedMode() };
  });

  app.get('/ai/decisions', async (request) => {
    const { limit } = request.query as { limit?: string };
    const parsed = Number(limit ?? 50);
    const safe = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;
    return listAiDecisions(safe);
  });

  app.get('/risk-events', async (request) => {
    const { limit } = request.query as { limit?: string };
    const parsed = Number(limit ?? 50);
    const safe = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;
    return listRiskEvents(safe);
  });
}
