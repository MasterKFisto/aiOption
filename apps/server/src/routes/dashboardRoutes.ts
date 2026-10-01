import type { FastifyInstance } from 'fastify';

import { roundMoney } from '@aioption/shared';
import type { AccountSummary } from '@aioption/shared';

import { binaryNetPnl } from '../binary/binaryRepository.js';
import { getBinarySessionService } from '../binary/binarySessionService.js';
import { latestAiSessionProfit } from '../binary-ai/binaryAiRepository.js';
import { getAccount, listAiDecisions, listPositions, listRiskEvents } from '../db/repositories.js';
import { liveMarket } from '../market/liveMarketDataService.js';
import { tradingLoop } from '../scheduler/tradingLoop.js';

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
  return {
    account,
    realizedPnl,
    binaryNetPnl: roundMoney(binaryNetPnl()),
    unrealizedPnl: 0,
    loopRunning: tradingLoop.isRunning,
    dailyLossLimitPercent: account.lossLimitPercent,
    dailyLossRemainingUsd,
    lossLimitFloorUsd,
    binarySessionGainUsd: roundMoney(sessionStats.combinedNetGain),
    binarySessionGainLimitUsd: sessionStats.gainLimitEnabled ? sessionStats.maxSessionGainUsdc : 0,
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
    const { status } = request.query as { status?: string };
    const positions = status === 'OPEN' || status === 'CLOSED' ? listPositions(status) : listPositions();
    // Enrich with expiry/countdown/current-price data for the UI.
    const tick = liveMarket.getLatestTick();
    const currentPrice = tick?.price ?? 0;
    const nowMs = Date.now();
    return positions.map((position) => {
      const stake = roundMoney(position.entryPremium * position.quantity);
      const expiresAtMs = position.expiresAt ? new Date(position.expiresAt).getTime() : null;
      const secondsRemaining =
        position.status === 'OPEN' && expiresAtMs ? Math.max(Math.ceil((expiresAtMs - nowMs) / 1000), 0) : 0;
      const winning =
        position.side === 'CALL' ? currentPrice > position.strikePrice : currentPrice < position.strikePrice;
      return {
        ...position,
        stakeUsd: stake,
        secondsRemaining,
        currentPrice,
        unrealizedPnl:
          position.status === 'OPEN' && currentPrice > 0
            ? roundMoney(winning ? stake * 0.8 : -stake)
            : 0,
        potentialProfitUsd: roundMoney(stake * 0.8),
        potentialLossUsd: stake,
      };
    });
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
