import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 6.5.1 end-to-end acceptance test through the REAL Fastify app
 * (buildApp: all routes, migrations, schedulers): deposit 100 → start →
 * open 10 USDT → only 10 locked → second open → sum locked → expiry →
 * automatic settlement by the 1 s scheduler → funds released.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-classic-e2e-'));

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let connection: typeof import('../src/db/connection.js');
let price = 67000;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  // Deterministic live feed: always fresh, price controlled by the test.
  const live = await import('../src/market/liveMarketDataService.js');
  vi.spyOn(live.liveMarket, 'start').mockImplementation(() => undefined);
  vi.spyOn(live.liveMarket, 'getLatestTick').mockImplementation(
    (): PriceTick => ({ price, timestamp: new Date().toISOString(), source: 'STUB' }),
  );
  connection = await import('../src/db/connection.js');
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const account = async () => (await app.inject({ method: 'GET', url: '/api/account' })).json().account;

describe('Phase 6.5.1 acceptance (full app)', () => {
  it('locks only the stake, sums multiple stakes, settles at expiry and releases funds', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 100 } });
    expect((await app.inject({ method: 'POST', url: '/api/classic/trading/start' })).statusCode).toBe(200);
    // Keep the AI loop from adding positions during the test.
    const { tradingLoop } = await import('../src/scheduler/tradingLoop.js');
    tradingLoop.stop();

    // Ticket default is 10 minutes.
    const config = (await app.inject({ method: 'GET', url: '/api/options/config' })).json();
    expect(config.defaultDurationSeconds).toBe(600);
    expect(config.maxDurationSeconds).toBe(3600);

    const first = await app.inject({
      method: 'POST',
      url: '/api/options/open',
      payload: { side: 'CALL', stakeUsd: 10, durationSeconds: config.defaultDurationSeconds },
    });
    expect(first.statusCode).toBe(201);
    expect(await account()).toMatchObject({ cashBalance: 90, lockedBalance: 10, equity: 100 });

    const second = await app.inject({
      method: 'POST',
      url: '/api/options/open',
      payload: { side: 'PUT', stakeUsd: 5, durationSeconds: 60 },
    });
    expect(second.statusCode).toBe(201);
    expect(await account()).toMatchObject({ cashBalance: 85, lockedBalance: 15, equity: 100 });

    // Open positions expose expiry + countdown.
    const open = (await app.inject({ method: 'GET', url: '/api/positions?status=OPEN' })).json();
    expect(open).toHaveLength(2);
    const ten = open.find((p: { durationSeconds: number }) => p.durationSeconds === 600);
    expect(ten.secondsRemaining).toBeGreaterThan(590);
    expect(ten.stakeUsd).toBe(10);

    // Expire the 10-min CALL; price rises → WIN. The real 1 s scheduler settles it.
    connection
      .getDb()
      .prepare('UPDATE positions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), first.json().id);
    price = 67500;
    await vi.waitFor(
      async () => {
        expect((await account()).lockedBalance).toBe(5);
      },
      { timeout: 4000, interval: 250 },
    );
    // 10 stake + 8 profit back to cash; only the 5 USDT PUT stays locked.
    expect(await account()).toMatchObject({ cashBalance: 103, lockedBalance: 5, equity: 108 });

    const history = (await app.inject({ method: 'GET', url: '/api/classic/history' })).json();
    expect(history[0]).toMatchObject({ settlementStatus: 'SETTLED', realizedPnl: 8, settlementPrice: 67500 });

    // Stop: no new opens, open PUT keeps running.
    await app.inject({ method: 'POST', url: '/api/classic/trading/stop' });
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/options/open',
      payload: { side: 'CALL', stakeUsd: 10, durationSeconds: 600 },
    });
    expect(blocked.statusCode).toBe(400);
    const status = (await app.inject({ method: 'GET', url: '/api/classic/status' })).json();
    expect(status).toMatchObject({ tradingEnabled: false, openPositions: 1, openClassicStakeUsd: 5, lockedBalance: 5 });
  });
});
