import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-trading-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let tradingLoop: typeof import('../src/scheduler/tradingLoop.js')['tradingLoop'];

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  tradingLoop = (await import('../src/scheduler/tradingLoop.js')).tradingLoop;
  const { walletRoutes } = await import('../src/routes/walletRoutes.js');
  const { tradingRoutes } = await import('../src/routes/tradingRoutes.js');
  connection.initDb();

  app = Fastify();
  await app.register(walletRoutes, { prefix: '/api/paper' });
  await app.register(tradingRoutes, { prefix: '/api/trading' });
});

afterAll(async () => {
  tradingLoop.stop();
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  tradingLoop.stop();
  repo.updateAccount({
    cashBalance: 0,
    lockedBalance: 0,
    equity: 0,
    tradingEnabled: false,
    startingEquity: 0,
    maxOpenPositions: 5,
    lossLimitPercent: 5,
    fixedTradeSizeUsd: 10,
  });
});

describe('trading routes', () => {
  it('rejects starting with no funds', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/trading/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Deposit paper funds/);
  });

  it('starts the loop, snapshots starting equity, and reports status', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 1000 } });

    const start = await app.inject({ method: 'POST', url: '/api/trading/start' });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ running: true, startingEquity: 1000 });
    expect(repo.getAccount().tradingEnabled).toBe(true);

    const status = await app.inject({ method: 'GET', url: '/api/trading/status' });
    const body = status.json();
    expect(body.running).toBe(true);
    expect(body.account.tradingEnabled).toBe(true);
    expect(body.account.startingEquity).toBe(1000);
  });

  it('keeps the original starting equity when restarted', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 1000 } });
    await app.inject({ method: 'POST', url: '/api/trading/start' });
    await app.inject({ method: 'POST', url: '/api/trading/stop' });
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 500 } });

    const restart = await app.inject({ method: 'POST', url: '/api/trading/start' });
    expect(restart.json().startingEquity).toBe(1000); // baseline preserved
  });

  it('updates risk settings via PUT and validates input', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/trading/risk/settings',
      payload: { maxOpenPositions: 3, lossLimitPercent: 8 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      maxOpenPositions: 3,
      lossLimitPercent: 8,
      fixedTradeSizeUsd: 10,
      postTradePromptEnabled: true,
      maxOptionStakeUsd: 100,
      optionDefaultDurationSeconds: 600,
    });

    const account = repo.getAccount();
    expect(account.maxOpenPositions).toBe(3);
    expect(account.lossLimitPercent).toBe(8);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/trading/risk/settings',
      payload: { maxOpenPositions: -1 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('updates only the provided risk settings (partial update)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/trading/risk/settings',
      payload: { lossLimitPercent: 12 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      maxOpenPositions: 5, // set in beforeEach → untouched by a partial update
      lossLimitPercent: 12,
      fixedTradeSizeUsd: 10,
      postTradePromptEnabled: true,
      maxOptionStakeUsd: 100,
      optionDefaultDurationSeconds: 600,
    });

    const account = repo.getAccount();
    expect(account.maxOpenPositions).toBe(5); // untouched
    expect(account.lossLimitPercent).toBe(12);
  });

  it('stops the loop and disables trading in the DB', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 1000 } });
    await app.inject({ method: 'POST', url: '/api/trading/start' });

    const stop = await app.inject({ method: 'POST', url: '/api/trading/stop' });
    expect(stop.json()).toEqual({ running: false });
    expect(repo.getAccount().tradingEnabled).toBe(false);

    const status = await app.inject({ method: 'GET', url: '/api/trading/status' });
    expect(status.json().running).toBe(false);
    expect(status.json().account.tradingEnabled).toBe(false);
  });
});
