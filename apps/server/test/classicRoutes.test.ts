import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-classic-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let loop: InstanceType<typeof import('../src/scheduler/tradingLoop.js')['TradingLoop']>;
let tickAgeMs = 0;

const feed = {
  getLatestTick: (): PriceTick => ({
    price: 67000,
    timestamp: new Date(Date.now() - tickAgeMs).toISOString(),
    source: 'STUB',
  }),
  getTickAtOrAfter: () => null,
};

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { OptionService } = await import('../src/options/optionService.js');
  const { optionRoutes } = await import('../src/options/optionRoutes.js');
  const { classicRoutes } = await import('../src/options/classicRoutes.js');
  const { TradingLoop } = await import('../src/scheduler/tradingLoop.js');
  connection.initDb();

  const service = new OptionService(feed);
  // Long interval: the loop never ticks during the test.
  loop = new TradingLoop({ intervalMs: 3_600_000, options: service });
  app = Fastify();
  await app.register(optionRoutes, { prefix: '/api', service });
  await app.register(classicRoutes, { prefix: '/api', service, loop });
});

afterAll(async () => {
  loop.stop();
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  tickAgeMs = 0;
  connection.getDb().prepare('DELETE FROM positions').run();
  connection.getDb().prepare("DELETE FROM app_settings WHERE key LIKE 'classic_%' OR key LIKE 'total_%'").run();
  repo.updateAccount({
    equity: 100,
    cashBalance: 100,
    lockedBalance: 0,
    startingEquity: 0,
    tradingEnabled: false,
    lossLimitPercent: 40,
    maxOptionStakeUsd: 100,
    optionDefaultDurationSeconds: 600,
  });
});

const start = () => app.inject({ method: 'POST', url: '/api/classic/trading/start' });
const open = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/options/open', payload });

describe('GET/PUT /api/classic/settings', () => {
  it('returns the 6.5.1 defaults (10 min default, 60 min max, 7 durations)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/classic/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tradingEnabled: false,
      defaultStakeUsd: 10,
      maxStakeUsd: 100,
      defaultDurationSeconds: 600,
      maxDurationSeconds: 3600,
      allowedDurationsSeconds: [60, 180, 300, 600, 900, 1800, 3600],
      dailyLossLimitPercent: 40,
      totalLossLimitPercent: 0,
      currentLockedBalance: 0,
      availableBalance: 100,
      openPositionCount: 0,
    });
  });

  it('saves settings immediately and audits every change', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/classic/settings',
      payload: {
        defaultStakeUsd: 25,
        maxStakeUsd: 50,
        defaultDurationSeconds: 1800,
        dailyLossLimitPercent: 30,
        totalLossLimitPercent: 60,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      defaultStakeUsd: 25,
      maxStakeUsd: 50,
      defaultDurationSeconds: 1800,
      dailyLossLimitPercent: 30,
      totalLossLimitPercent: 60,
    });
    // Backend state really changed (account + app_settings).
    expect(repo.getAccount()).toMatchObject({
      maxOptionStakeUsd: 50,
      optionDefaultDurationSeconds: 1800,
      lossLimitPercent: 30,
    });
    const keys = repo.listSettingsAudit(20).map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'classic_max_stake_usd',
        'classic_default_duration_seconds',
        'daily_loss_limit_percent',
        'classic_default_stake_usd',
        'total_loss_limit_percent',
      ]),
    );
  });

  it('rejects invalid values and saves nothing', async () => {
    const cases = [
      { maxStakeUsd: 101 },
      { maxStakeUsd: 0 },
      { defaultStakeUsd: 60, maxStakeUsd: 50 },
      { defaultDurationSeconds: 7200 },
      { defaultDurationSeconds: 90 },
      { dailyLossLimitPercent: 95 },
      { totalLossLimitPercent: -1 },
      { unknownField: 1 },
      { maxStakeUsd: '50' },
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'PUT', url: '/api/classic/settings', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(repo.getAccount()).toMatchObject({ maxOptionStakeUsd: 100, optionDefaultDurationSeconds: 600 });
  });
});

describe('POST /api/classic/trading/start|stop + GET /api/classic/status', () => {
  it('start enables trading, snapshots the baseline and reports status', async () => {
    const res = await start();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tradingEnabled: true, blockedReason: null, loopRunning: true });
    expect(repo.getAccount()).toMatchObject({ tradingEnabled: true, startingEquity: 100 });
  });

  it('start is refused without funds', async () => {
    repo.updateAccount({ equity: 0, cashBalance: 0 });
    expect((await start()).statusCode).toBe(400);
  });

  it('stop blocks new opens but keeps the master switch and open positions', async () => {
    await start();
    expect((await open({ side: 'CALL', stakeUsd: 10, durationSeconds: 600 })).statusCode).toBe(201);
    const stop = await app.inject({ method: 'POST', url: '/api/classic/trading/stop' });
    expect(stop.json()).toMatchObject({ tradingEnabled: false, blockedReason: 'TRADING_DISABLED', openPositions: 1 });
    // Binary keeps working: the master switch stays on.
    expect(repo.getAccount().tradingEnabled).toBe(true);
    expect(repo.listPositions('OPEN')).toHaveLength(1);
    const rejected = await open({ side: 'CALL', stakeUsd: 10, durationSeconds: 600 });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe('TRADING_DISABLED');
  });

  it('status reports MARKET_DATA_STALE and DAILY_LOSS_LIMIT_REACHED', async () => {
    await start();
    tickAgeMs = 60_000;
    let status = (await app.inject({ method: 'GET', url: '/api/classic/status' })).json();
    expect(status.blockedReason).toBe('MARKET_DATA_STALE');
    tickAgeMs = 0;
    repo.updateAccount({ equity: 60, cashBalance: 60 }); // 60 <= 100 * (1 - 0.4)
    status = (await app.inject({ method: 'GET', url: '/api/classic/status' })).json();
    expect(status.blockedReason).toBe('DAILY_LOSS_LIMIT_REACHED');
  });
});

describe('POST /api/options/open — Phase 6.5.1 locking and validation', () => {
  beforeEach(async () => {
    await start();
  });

  it('a 10 USDT open locks exactly 10 and status shows the sum of stakes', async () => {
    expect((await open({ side: 'CALL', stakeUsd: 10, durationSeconds: 600 })).statusCode).toBe(201);
    expect((await open({ side: 'PUT', stakeUsd: 15, durationSeconds: 60 })).statusCode).toBe(201);
    const status = (await app.inject({ method: 'GET', url: '/api/classic/status' })).json();
    expect(status).toMatchObject({ lockedBalance: 25, openClassicStakeUsd: 25, availableBalance: 75, openPositions: 2 });
  });

  it('returns the exact error messages', async () => {
    let res = await open({ side: 'CALL', stakeUsd: 101, durationSeconds: 600 });
    expect(res.json().error).toBe('Maximum option stake is 100 USDT.');
    res = await open({ side: 'CALL', stakeUsd: 10, durationSeconds: 7200 });
    expect(res.json().error).toBe('Invalid option duration.');
    res = await open({ side: 'CALL', stakeUsd: 10 }); // missing duration
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid option duration.');
    res = await open({ side: 'CALL', stakeUsd: 10, durationSeconds: '600' }); // no coercion
    expect(res.json().error).toBe('Invalid option duration.');
    repo.updateAccount({ cashBalance: 5, lockedBalance: 95 });
    res = await open({ side: 'CALL', stakeUsd: 10, durationSeconds: 600 });
    expect(res.json().error).toBe('Insufficient available balance.');
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('rejects other assets and injection payloads', async () => {
    for (const asset of ['ETH/USDT', "BTC/USDT'; DROP TABLE positions;--", '']) {
      expect((await open({ asset, side: 'CALL', stakeUsd: 10, durationSeconds: 600 })).statusCode).toBe(400);
    }
    expect(connection.getDb().prepare('SELECT COUNT(*) AS n FROM positions').get()).toEqual({ n: 0 });
  });
});

describe('GET /api/classic/history + POST /api/classic/repair-locked-balance', () => {
  it('lists settled positions with their stake, and repair fixes drift', async () => {
    await start();
    await open({ side: 'CALL', stakeUsd: 10, durationSeconds: 60 });
    const id = repo.listPositions('OPEN')[0]!.id;
    connection
      .getDb()
      .prepare('UPDATE positions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 10_000).toISOString(), id);
    const { OptionService } = await import('../src/options/optionService.js');
    new OptionService(feed).settleDueOptions();

    const history = (await app.inject({ method: 'GET', url: '/api/classic/history?limit=5' })).json();
    expect(history[0]).toMatchObject({ id, status: 'CLOSED', stakeUsd: 10 });
    expect((await app.inject({ method: 'GET', url: '/api/classic/history?limit=9999' })).statusCode).toBe(400);

    repo.updateAccount({ lockedBalance: 50, cashBalance: 50 }); // drift
    const repair = (await app.inject({ method: 'POST', url: '/api/classic/repair-locked-balance' })).json();
    expect(repair).toMatchObject({ repaired: true, expectedLocked: 0 });
    expect(repo.getAccount().lockedBalance).toBe(0);
  });
});


describe('GET/PUT /api/classic/strategy (Phase 6.5.2)', () => {
  it('returns the env defaults and the live direction state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/classic/strategy' });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      requireNeutralCooldown: true,
      maxConsecutiveSameDirection: 3,
      cooldownAfterMaxConsecutiveMs: 300_000,
    });
    expect(res.json().direction).toMatchObject({
      consecutivePutCount: expect.any(Number),
      consecutiveCallCount: expect.any(Number),
      putBlockedUntil: null,
      callBlockedUntil: null,
    });
  });

  it('saves to app_settings (audited) and returns the new values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/classic/strategy',
      payload: { rsiOverbought: 75, rsiOversold: 25, maxConsecutiveSameDirection: 4, cooldownAfterMaxConsecutiveMs: 600_000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({
      rsiOverbought: 75,
      rsiOversold: 25,
      maxConsecutiveSameDirection: 4,
      cooldownAfterMaxConsecutiveMs: 600_000,
    });
    expect(repo.getAppSetting('classic_ai_rsi_overbought')?.value).toBe('75');
    expect(repo.listSettingsAudit(10).map((e) => e.key)).toEqual(
      expect.arrayContaining(['classic_ai_rsi_overbought', 'classic_max_consecutive_same_direction']),
    );
    // restore defaults for other tests
    await app.inject({
      method: 'PUT',
      url: '/api/classic/strategy',
      payload: { rsiOverbought: 70, rsiOversold: 30, maxConsecutiveSameDirection: 3, cooldownAfterMaxConsecutiveMs: 300_000 },
    });
  });

  it('rejects invalid values and saves nothing', async () => {
    const cases = [
      { rsiOverbought: 50 },
      { rsiOverbought: 100 },
      { rsiOversold: 50 },
      { rsiOversold: 0 },
      { rsiPeriod: 1 },
      { rsiPeriod: 14.5 },
      { maxConsecutiveSameDirection: 0 },
      { maxConsecutiveSameDirection: 21 },
      { cooldownAfterMaxConsecutiveMs: -1 },
      { cooldownAfterMaxConsecutiveMs: 86_400_001 },
      { requireNeutralCooldown: 'yes' },
      { unknown: 1 },
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'PUT', url: '/api/classic/strategy', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const settings = (await app.inject({ method: 'GET', url: '/api/classic/strategy' })).json().settings;
    expect(settings.rsiOverbought).toBe(70);
    expect(settings.maxConsecutiveSameDirection).toBe(3);
  });
});

