import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 6.5.3 acceptance through the REAL app: account summary, positions
 * and binary endpoints expose a clear realized / unrealized / exposure split.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-unrealized-api-'));

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');
let price = 60_000;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  const live = await import('../src/market/liveMarketDataService.js');
  vi.spyOn(live.liveMarket, 'start').mockImplementation(() => undefined);
  vi.spyOn(live.liveMarket, 'getLatestTick').mockImplementation(
    (): PriceTick => ({ price, timestamp: new Date().toISOString(), source: 'STUB' }),
  );
  // Binary settlement uses the first tick at/after expiry.
  vi.spyOn(live.liveMarket, 'getTickAtOrAfter').mockImplementation(
    (): PriceTick => ({ price, timestamp: new Date().toISOString(), source: 'STUB' }),
  );
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const summary = async () => (await app.inject({ method: 'GET', url: '/api/account' })).json();
const expireAll = (table: 'positions' | 'binary_contracts') =>
  connection
    .getDb()
    .prepare(`UPDATE ${table} SET expires_at = ? WHERE status = 'OPEN'`)
    .run(new Date(Date.now() - 1000).toISOString());
const stopAiLoop = async () => (await import('../src/scheduler/tradingLoop.js')).tradingLoop.stop();

describe('Phase 6.5.3 — classic options', () => {
  it('unrealized PnL and binary exposure are zero when nothing is open', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 1000 } });
    expect(await summary()).toMatchObject({
      unrealizedPnl: 0,
      openClassicUnrealizedPnl: 0,
      openBinaryExposure: 0,
      openBinaryCount: 0,
      estimatedBinaryUnrealizedPnl: null,
      binaryUnrealizedMode: 'CONSERVATIVE',
      availableBalance: 1000,
      lockedBalance: 0,
      totalEquity: 1000,
      realizedPnl: 0,
    });
  });

  it('shows a LIVE, bounded unrealized PnL while open', async () => {
    await app.inject({ method: 'POST', url: '/api/classic/trading/start' });
    await stopAiLoop();
    price = 60_000;
    const open = await app.inject({
      method: 'POST',
      url: '/api/options/open',
      payload: { side: 'CALL', stakeUsd: 10, durationSeconds: 600 },
    });
    expect(open.statusCode).toBe(201);

    price = 60_150; // in favour of the CALL
    const up = await summary();
    expect(up.openClassicUnrealizedPnl).toBeGreaterThan(0);
    expect(up.openClassicUnrealizedPnl).toBeLessThanOrEqual(8); // ≤ max profit
    expect(up.unrealizedPnl).toBe(up.openClassicUnrealizedPnl);
    expect(up.lockedBalance).toBe(10);

    price = 59_850; // against it
    const down = await summary();
    expect(down.openClassicUnrealizedPnl).toBeLessThan(0);
    expect(down.openClassicUnrealizedPnl).toBeGreaterThanOrEqual(-10); // ≥ −stake

    const positions = (await app.inject({ method: 'GET', url: '/api/positions?status=OPEN' })).json();
    expect(positions[0]).toMatchObject({
      positionType: 'CLASSIC',
      status: 'OPEN',
      lockedStake: 10,
      currentPrice: 59_850,
      currentStatus: null,
      unrealizedPnl: down.openClassicUnrealizedPnl,
    });
    expect(positions[0].timeRemainingMs).toBeGreaterThan(590_000);
    expect(positions[0].expiresAt).toBeTruthy();
  });

  it('returns to zero after settlement (result moves to realized)', async () => {
    price = 60_300;
    expireAll('positions');
    await vi.waitFor(async () => expect((await summary()).lockedBalance).toBe(0), {
      timeout: 4000,
      interval: 250,
    });
    const s = await summary();
    expect(s.unrealizedPnl).toBe(0);
    expect(s.openClassicUnrealizedPnl).toBe(0);
    expect(s.realizedPnl).toBe(8); // WIN: 10 × 0.8 realized
  });
});

describe('Phase 6.5.3 — binary options', () => {
  it('locked stake + live status, but NO profit before settlement', async () => {
    price = 60_000;
    const opened = await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { direction: 'UP', stakeUsd: 5, durationSeconds: 10, payoutRatio: 0.8 },
    });
    expect(opened.statusCode).toBe(201);
    price = 60_500; // currently winning

    const contracts = (await app.inject({ method: 'GET', url: '/api/binary/open' })).json();
    expect(contracts[0]).toMatchObject({
      currentStatus: 'WINNING',
      currentPrice: 60_500,
      potentialProfit: 4,
      potentialLoss: 5,
      estimatedUnrealizedPnl: null, // conservative default
      status: 'OPEN',
      result: null, // no final result yet
    });
    expect(contracts[0].timeRemainingMs).toBeGreaterThan(0);

    const s = await summary();
    expect(s.openBinaryExposure).toBe(5);
    expect(s.openBinaryCount).toBe(1);
    expect(s.lockedBalance).toBe(5);
    expect(s.unrealizedPnl).toBe(0); // binary never adds to unrealized
    expect(s.binaryNetPnl).toBe(0); // and is not realized before expiry

    const unified = (
      await app.inject({ method: 'GET', url: '/api/positions?status=OPEN&include=binary' })
    ).json();
    const binaryRow = unified.find((p: { positionType: string }) => p.positionType === 'BINARY');
    expect(binaryRow).toMatchObject({ lockedStake: 5, unrealizedPnl: 0, currentStatus: 'WINNING' });
  });

  it('ESTIMATED mode shows a separate estimate, never mixed into unrealized PnL', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/binary-unrealized',
      payload: { showEstimated: true },
    });
    expect(res.json()).toEqual({ mode: 'ESTIMATED' });
    expect(repo.getAppSetting('binary_show_estimated_unrealized_pnl')?.value).toBe('true');

    const s = await summary();
    expect(s.binaryUnrealizedMode).toBe('ESTIMATED');
    expect(s.estimatedBinaryUnrealizedPnl).toBeGreaterThan(0);
    expect(s.estimatedBinaryUnrealizedPnl).toBeLessThanOrEqual(4);
    expect(s.unrealizedPnl).toBe(0);
    const contracts = (await app.inject({ method: 'GET', url: '/api/binary/open' })).json();
    expect(contracts[0].estimatedUnrealizedPnl).toBeGreaterThan(0);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/settings/binary-unrealized',
      payload: { showEstimated: 'yes' },
    });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: '/api/settings/binary-unrealized', payload: { showEstimated: false } });
    expect((await summary()).estimatedBinaryUnrealizedPnl).toBeNull();
  });

  it('after settlement exposure is zero and the result is realized', async () => {
    expireAll('binary_contracts');
    await vi.waitFor(async () => expect((await summary()).openBinaryExposure).toBe(0), {
      timeout: 4000,
      interval: 250,
    });
    const s = await summary();
    expect(s.binaryNetPnl).toBe(4); // UP won at 60_500 → +4 realized
    expect(s.unrealizedPnl).toBe(0);
    expect(s.lockedBalance).toBe(0);
  });

  it('the setting is seeded by the migration and preserved', () => {
    expect(repo.getAppSetting('binary_show_estimated_unrealized_pnl')?.value).toBe('false');
  });
});

