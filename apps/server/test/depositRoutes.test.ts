import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-deposits-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { depositRoutes } = await import('../src/routes/depositRoutes.js');
  connection.initDb();

  app = Fastify();
  await app.register(depositRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('deposit routes (simulated Tron)', () => {
  it('GET /api/deposits/info returns the fixed Tron USDT TRC20 deposit info', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deposits/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.network).toBe('TRON');
    expect(body.asset).toBe('USDT');
    expect(body.tokenStandard).toBe('TRC20');
    expect(body.address).toMatch(/^T/);
    expect(body.tronMode).toBe('SIMULATED');
    expect(body.liveWithdrawalsEnabled).toBe(false);
  });

  it('POST /api/deposits/simulate credits the wallet and records network=TRON, asset=USDT, TRC20', async () => {
    const before = repo.listTransactions().length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/simulate',
      payload: { amount: 250 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deposit.network).toBe('TRON');
    expect(body.deposit.asset).toBe('USDT');
    expect(body.deposit.tokenStandard).toBe('TRC20');
    expect(body.deposit.status).toBe('CONFIRMED');
    expect(body.deposit.txid).toMatch(/^sim-/);
    expect(body.account.cashBalance).toBe(250);
    expect(repo.listTransactions().length).toBe(before + 1);
  });

  it('does not double-credit the same transfer on re-sync (unique txid)', async () => {
    const { syncDepositsOnce } = await import('../src/services/depositSyncService.js');
    const credited = await syncDepositsOnce();
    expect(credited).toBe(0); // all transfers already processed
    expect(repo.listDeposits().length).toBe(1);
    expect(repo.getAccount().cashBalance).toBe(250);
  });

  it('rejects invalid simulate payloads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deposits/simulate',
      payload: { amount: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/deposits lists the recorded deposits', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deposits' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].network).toBe('TRON');
  });
});
