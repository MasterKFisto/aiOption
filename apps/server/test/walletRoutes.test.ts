import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let walletRoutes: typeof import('../src/routes/walletRoutes.js')['walletRoutes'];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  walletRoutes = (await import('../src/routes/walletRoutes.js')).walletRoutes;
  connection.initDb();

  app = Fastify();
  await app.register(walletRoutes, { prefix: '/api/paper' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  repo.updateAccount({ cashBalance: 0, lockedBalance: 0, equity: 0 });
});

describe('wallet routes', () => {
  it('POST /api/paper/deposit creates a DEPOSIT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/paper/deposit',
      payload: { amount: 500, description: 'test funds' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.transaction.type).toBe('DEPOSIT');
    expect(body.transaction.amount).toBe(500);
    expect(body.account.cashBalance).toBe(500);
  });

  it('POST /api/paper/withdraw moves funds and returns 201', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 1000 } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/paper/withdraw',
      payload: { amount: 250 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.transaction.type).toBe('WITHDRAWAL');
    expect(body.transaction.amount).toBe(-250);
    expect(body.account.cashBalance).toBe(750);
  });

  it('rejects withdrawals above the balance with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/paper/withdraw',
      payload: { amount: 99999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Insufficient funds/);
  });

  it('rejects invalid payloads with 400', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: {} });
    expect(missing.statusCode).toBe(400);

    const negative = await app.inject({
      method: 'POST',
      url: '/api/paper/deposit',
      payload: { amount: -5 },
    });
    expect(negative.statusCode).toBe(400);

    const garbage = await app.inject({
      method: 'POST',
      url: '/api/paper/deposit',
      payload: { amount: 'not-a-number' },
    });
    expect(garbage.statusCode).toBe(400);
  });

  it('GET /api/paper/balances returns the account', async () => {
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 123 } });
    const res = await app.inject({ method: 'GET', url: '/api/paper/balances' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cashBalance).toBe(123);
    expect(body.baseCurrency).toBe('USDT');
  });

  it('every API wallet movement is persisted as a transaction', async () => {
    const before = repo.listTransactions().length;
    await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 100 } });
    await app.inject({ method: 'POST', url: '/api/paper/withdraw', payload: { amount: 20 } });
    expect(repo.listTransactions().length).toBe(before + 2);
  });
});
