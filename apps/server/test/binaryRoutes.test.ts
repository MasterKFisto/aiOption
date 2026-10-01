import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-binary-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { binaryRoutes } = await import('../src/binary/binaryRoutes.js');
  connection.initDb();

  app = Fastify();
  await app.register(binaryRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('binary routes', () => {
  it('GET /api/binary/config returns the configured limits', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/binary/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.liveTradingEnabled).toBe(false);
    expect(body.allowedDurationsSeconds).toEqual([5, 10]);
    expect(body.allowedPayoutRatios).toEqual([0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(body.minStakeUsd).toBe(1);
    expect(body.maxStakeUsd).toBe(50);
    expect(body.maxOpenContracts).toBe(3);
  });

  it('GET /api/server-time returns ISO server time', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/server-time' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(new Date(body.serverTime).getTime()).toBeGreaterThan(0);
    expect(typeof body.epochMs).toBe('number');
  });

  it('rejects invalid open payloads with 400', async () => {
    const cases = [
      { direction: 'SIDEWAYS', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
      { direction: 'UP', stakeUsd: 0.1, durationSeconds: 5, payoutRatio: 0.8 },
      { direction: 'UP', stakeUsd: 10, durationSeconds: 7, payoutRatio: 0.8 },
      { direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.42 },
      {},
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/binary/open', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects opening while trading is disabled (deterministic on a fresh DB)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { asset: 'BTC/USDC', direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/trading is disabled/);
    expect(repo.listRiskEvents()[0]?.type).toBe('BINARY_CONTRACT_REJECTED');
  });

  it('rejects invalid quote parameters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/binary/quote?stake=10&duration=5&payoutRatio=0.42',
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists open contracts, history and summary (empty state)', async () => {
    const open = await app.inject({ method: 'GET', url: '/api/binary/open' });
    expect(open.json()).toEqual([]);
    const history = await app.inject({ method: 'GET', url: '/api/binary/history' });
    expect(history.json()).toEqual([]);
    const summary = await app.inject({ method: 'GET', url: '/api/binary/summary' });
    expect(summary.json()).toMatchObject({ wins: 0, losses: 0, refunds: 0, openCount: 0 });
  });
});
