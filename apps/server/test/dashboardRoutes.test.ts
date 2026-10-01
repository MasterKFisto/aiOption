import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-dashboard-test-'));
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
  const { dashboardRoutes } = await import('../src/routes/dashboardRoutes.js');
  connection.initDb();

  app = Fastify();
  await app.register(dashboardRoutes, { prefix: '/api' });
});

afterAll(async () => {
  tradingLoop.stop();
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  tradingLoop.stop();
  for (const p of repo.listPositions('OPEN')) {
    repo.updatePosition(p.id, { status: 'CLOSED', closedAt: new Date().toISOString() });
  }
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

describe('dashboard routes', () => {
  it('GET /api/account/summary returns the account with zeroed PnL and loop state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/account/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.account.equity).toBe(0);
    expect(body.account.cashBalance).toBe(0);
    expect(body.realizedPnl).toBe(0);
    expect(body.unrealizedPnl).toBe(0);
    expect(body.loopRunning).toBe(false);
  });

  it('GET /api/account/summary sums realized PnL from closed positions', async () => {
    const first = repo.createPosition({
      symbol: 'BTC-2026-10-08-67000-C',
      side: 'CALL',
      strikePrice: 67000,
      expiry: '2026-10-08',
      quantity: 1,
      entryPremium: 100,
      openedAt: new Date().toISOString(),
    });
    repo.updatePosition(first.id, {
      status: 'CLOSED',
      exitPremium: 250,
      realizedPnl: 150,
      closedAt: new Date().toISOString(),
    });
    const second = repo.createPosition({
      symbol: 'ETH-2026-10-08-2600-P',
      side: 'PUT',
      strikePrice: 2600,
      expiry: '2026-10-08',
      quantity: 1,
      entryPremium: 50,
      openedAt: new Date().toISOString(),
    });
    repo.updatePosition(second.id, {
      status: 'CLOSED',
      exitPremium: 30,
      realizedPnl: -20,
      closedAt: new Date().toISOString(),
    });
    // one open position does not count towards realized PnL
    repo.createPosition({
      symbol: 'BTC-2026-10-15-68000-C',
      side: 'CALL',
      strikePrice: 68000,
      expiry: '2026-10-15',
      quantity: 1,
      entryPremium: 90,
      openedAt: new Date().toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/api/account/summary' });
    expect(res.json().realizedPnl).toBe(130);
  });

  it('GET /api/positions filters by status and returns all without a filter', async () => {
    const before = repo.listPositions().length;
    const open = repo.createPosition({
      symbol: 'BTC-2026-10-08-67000-C',
      side: 'CALL',
      strikePrice: 67000,
      expiry: '2026-10-08',
      quantity: 1,
      entryPremium: 100,
      openedAt: new Date().toISOString(),
    });
    repo.updatePosition(open.id, {
      status: 'CLOSED',
      exitPremium: 120,
      realizedPnl: 20,
      closedAt: new Date().toISOString(),
    });
    const stillOpen = repo.createPosition({
      symbol: 'ETH-2026-10-08-2600-C',
      side: 'CALL',
      strikePrice: 2600,
      expiry: '2026-10-08',
      quantity: 1,
      entryPremium: 60,
      openedAt: new Date().toISOString(),
    });

    const all = await app.inject({ method: 'GET', url: '/api/positions' });
    expect(all.json()).toHaveLength(before + 2);

    const openOnly = await app.inject({ method: 'GET', url: '/api/positions?status=OPEN' });
    expect(openOnly.json()).toHaveLength(1);
    expect(openOnly.json()[0].id).toBe(stillOpen.id);

    const closedOnly = await app.inject({ method: 'GET', url: '/api/positions?status=CLOSED' });
    const closed = closedOnly.json();
    expect(closed.some((p: { id: number }) => p.id === open.id)).toBe(true);
    expect(closed.find((p: { id: number }) => p.id === open.id).realizedPnl).toBe(20);
  });

  it('GET /api/ai/decisions honors the limit and clamps unreasonable values', async () => {
    for (let i = 0; i < 5; i++) {
      repo.logAiDecision({
        symbol: 'BTC/USDT',
        signal: 'BULLISH',
        action: 'OPEN_CALL',
        confidence: 0.7,
        expectedReturn: 0.03,
        proposedTradeSizeUsd: 10,
        rationale: 'test',
        executed: false,
        positionId: null,
      });
    }
    const limited = await app.inject({ method: 'GET', url: '/api/ai/decisions?limit=2' });
    expect(limited.json()).toHaveLength(2);

    const clamped = await app.inject({ method: 'GET', url: '/api/ai/decisions?limit=99999' });
    expect(clamped.json()).toHaveLength(5); // clamped to the stored rows

    const garbage = await app.inject({ method: 'GET', url: '/api/ai/decisions?limit=abc' });
    expect(garbage.json()).toHaveLength(5); // default 50
  });

  it('GET /api/account returns the latest equity and balances', async () => {
    repo.updateAccount({ equity: 321, cashBalance: 123 });
    const res = await app.inject({ method: 'GET', url: '/api/account' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.account.equity).toBe(321);
    expect(body.account.cashBalance).toBe(123);
    expect(typeof body.realizedPnl).toBe('number');
    expect(body.loopRunning).toBe(false);
  });

  it('GET /api/risk-events returns logged risk events', async () => {
    repo.logRiskEvent({ type: 'LOSS_LIMIT_DAILY', message: 'test event', equityAtTrigger: 900 });
    const res = await app.inject({ method: 'GET', url: '/api/risk-events?limit=5' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list[0]?.type).toBe('LOSS_LIMIT_DAILY');
    expect(list[0]?.equityAtTrigger).toBe(900);
  });

  it('treats invalid or malicious query values safely', async () => {
    const before = repo.listAiDecisions().length;
    repo.logAiDecision({
      symbol: 'BTC/USDT',
      signal: 'BULLISH',
      action: 'OPEN_CALL',
      confidence: 0.7,
      expectedReturn: 0.03,
      proposedTradeSizeUsd: 10,
      rationale: 'security test',
      executed: false,
      positionId: null,
    });

    // limit=0 falls back to the default (returns all stored rows)
    const zero = await app.inject({ method: 'GET', url: '/api/ai/decisions?limit=0' });
    expect(zero.statusCode).toBe(200);
    expect(zero.json()).toHaveLength(before + 1);

    // SQL-injection attempt in a query param must be inert
    const evil = await app.inject({
      method: 'GET',
      url: '/api/ai/decisions?limit=10%3B%20DROP%20TABLE%20account',
    });
    expect(evil.statusCode).toBe(200);

    const tables = connection
      .getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as ReadonlyArray<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('account');

    // unknown status values are ignored (no crash, no filter)
    const oddStatus = await app.inject({
      method: 'GET',
      url: "/api/positions?status=OPEN'; DROP TABLE positions--",
    });
    expect(oddStatus.statusCode).toBe(200);
  });
});
