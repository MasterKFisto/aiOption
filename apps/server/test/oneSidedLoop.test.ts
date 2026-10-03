import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 6.5.2 acceptance: reproduces the reported bug scenario — the Classic
 * AI running unattended for many hours on simulated data — and proves it no
 * longer trades one side only. Uses the REAL simulator, signal engine, risk
 * engine, direction guard and OptionService with a simulated clock.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-one-sided-'));

let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  connection.initDb();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Phase 6.5.2 — no infinite one-sided trading loop', () => {
  it('48 simulated hours of the AI loop trade both CALL and PUT and never exceed the streak limit', async () => {
    const { SimulatedMarketDataService } = await import('../src/market/marketDataService.js');
    const { TradingLoop } = await import('../src/scheduler/tradingLoop.js');
    const { OptionService } = await import('../src/options/optionService.js');
    const { DirectionGuard } = await import('../src/strategy/directionGuard.js');

    let now = Date.UTC(2026, 9, 2, 0, 0, 0);
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const market = new SimulatedMarketDataService({ now: () => now });
      const tick = (): PriceTick => ({
        price: market.getTicker('BTC/USDT').lastPrice,
        timestamp: new Date(now).toISOString(),
        source: 'SIM',
      });
      const options = new OptionService({ getLatestTick: tick, getTickAtOrAfter: () => null });
      const guard = new DirectionGuard(() => now);
      const loop = new TradingLoop({ market, options, guard, intervalMs: 60_000 });

      // Default account: maxOpenPositions = 0 (unlimited) since Phase 6.5.2.
      expect(repo.getAccount().maxOpenPositions).toBe(0);
      repo.updateAccount({
        equity: 100_000,
        cashBalance: 100_000,
        lockedBalance: 0,
        tradingEnabled: true,
        startingEquity: 100_000,
        lossLimitPercent: 80,
      });

      // One loop tick per simulated minute, settling expired options as we go.
      for (let minute = 0; minute < 48 * 60; minute++) {
        now += 60_000;
        vi.setSystemTime(now);
        options.settleDueOptions();
        await loop.runOnce();
      }

      const ai = connection
        .getDb()
        .prepare("SELECT side FROM positions WHERE source = 'AI' ORDER BY opened_at, id")
        .all() as Array<{ side: 'CALL' | 'PUT' }>;
      const calls = ai.filter((p) => p.side === 'CALL').length;
      const puts = ai.filter((p) => p.side === 'PUT').length;

      // Trades happened, on BOTH sides.
      expect(ai.length).toBeGreaterThan(10);
      expect(calls).toBeGreaterThan(0);
      expect(puts).toBeGreaterThan(0);
      // Neither side dominates like the old 100% PUT behaviour.
      expect(Math.min(calls, puts) / ai.length).toBeGreaterThan(0.15);

      // Longest same-direction run never exceeds the configured max (3).
      let longest = 0;
      let run = 0;
      for (let i = 0; i < ai.length; i++) {
        run = i > 0 && ai[i]!.side === ai[i - 1]!.side ? run + 1 : 1;
        longest = Math.max(longest, run);
      }
      expect(longest).toBeLessThanOrEqual(3);

      // Never stalls: trades keep happening across the whole 48 h (no hour-
      // long gaps caused by streak cooldowns or caps), and no trade-count cap.
      const opened = connection
        .getDb()
        .prepare("SELECT opened_at FROM positions WHERE source = 'AI' ORDER BY opened_at")
        .all() as Array<{ opened_at: string }>;
      const hours = new Set(opened.map((p) => p.opened_at.slice(0, 13)));
      expect(hours.size).toBeGreaterThanOrEqual(40); // trades in ≥ 40 of 48 hours
      expect(ai.length).toBeGreaterThan(200); // far beyond any old cap (5 / 30 per hour)
      const caps = repo
        .listRiskEvents(10_000)
        .filter((e) => /reached the limit|trades\/hour|open contracts reached/.test(e.message));
      expect(caps).toHaveLength(0);

      // Decisions carry full features; RSI filters actually fired at times.
      const decisions = repo.listAiDecisions(5000);
      expect(decisions.every((d) => d.features && typeof d.features.rsi === 'number')).toBe(true);
      const finals = new Set(decisions.map((d) => d.features!.finalSignal));
      expect(finals).toEqual(new Set(['CALL', 'PUT', 'NEUTRAL']));
      // Locked balance always equals open stakes (Phase 6.5.1 invariant).
      expect(repo.getAccount().lockedBalance).toBe(repo.sumOpenPositionStakes());
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);
});
