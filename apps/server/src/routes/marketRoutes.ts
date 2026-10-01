import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import {
  CANDLE_INTERVALS,
  liveMarket,
} from '../market/liveMarketDataService.js';

const candlesQuerySchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Z0-9]{1,16}(?:\/[A-Z0-9]{1,16})?$/i, 'invalid market symbol')
    .default(config.MARKET_SYMBOL),
  interval: z.enum(CANDLE_INTERVALS).default('1m'),
  limit: z.coerce.number().int().min(1).max(300).default(300),
});

/**
 * Live market data endpoints (public price source, polled every 2-5s).
 * Registered with prefix /api/market.
 */
export async function marketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ticker', async () => ({
    status: liveMarket.getStatus(),
    ticker: liveMarket.getTicker(),
  }));

  app.get('/ticks', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 120, 1), 300);
    return {
      symbol: liveMarket.getTicker()?.symbol ?? config.MARKET_SYMBOL,
      ticks: liveMarket.getRecentTicks(limit),
    };
  });

  app.get('/candles', async (request, reply) => {
    const parsed = candlesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { interval, limit } = parsed.data;
    try {
      const candles = await liveMarket.getCandles(interval, limit);
      const ticker = liveMarket.getTicker();
      return {
        symbol: ticker?.symbol ?? parsed.data.symbol,
        interval,
        source: 'COINBASE',
        candles,
      };
    } catch (err) {
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : 'market data unavailable' });
    }
  });
}
