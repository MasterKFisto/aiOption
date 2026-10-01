import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-withdrawals-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // well-known USDT TRC20 address

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { withdrawalRoutes } = await import('../src/routes/withdrawalRoutes.js');
  connection.initDb();

  app = Fastify();
  await app.register(withdrawalRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: false,
    startingEquity: 0,
  });
});

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  amount: 100,
  destinationAddress: TRON_ADDRESS,
  confirmed: true,
  ...overrides,
});

describe('withdrawal routes (simulated Tron)', () => {
  it('rejects malformed payloads', async () => {
    const cases: Array<Record<string, unknown>> = [
      validPayload({ amount: -1 }),
      validPayload({ amount: 0 }),
      validPayload({ destinationAddress: '0xabc123' }), // not a Tron address
      validPayload({ destinationAddress: '' }),
      validPayload({ confirmed: false }),
      {}, // missing everything
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/withdrawals', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects withdrawals above the available balance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/withdrawals',
      payload: validPayload({ amount: 501 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Insufficient funds/);
  });

  it('simulates the withdrawal: wallet debited, status SIMULATED, history recorded', async () => {
    const before = repo.listTransactions().length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/withdrawals',
      payload: validPayload({ amount: 120 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.withdrawal.status).toBe('SIMULATED');
    expect(body.withdrawal.network).toBe('TRON');
    expect(body.withdrawal.asset).toBe('USDC');
    expect(body.withdrawal.tokenStandard).toBe('TRC20');
    expect(body.withdrawal.destinationAddress).toBe(TRON_ADDRESS);
    expect(body.withdrawal.txid).toMatch(/^sim-/);
    expect(body.account.cashBalance).toBe(380);
    expect(repo.listTransactions().length).toBe(before + 1);
    expect(repo.listTransactions()[0]?.type).toBe('WITHDRAWAL');
  });

  it('GET /api/withdrawals lists history', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/withdrawals' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].network).toBe('TRON');
  });
});
