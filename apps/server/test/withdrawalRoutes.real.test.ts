import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-withdrawals-real-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  // Live Tron mode, but live withdrawals NOT enabled — the safe default.
  process.env['TRON_MODE'] = 'MAINNET';
  process.env['ENABLE_LIVE_TRON_WITHDRAWALS'] = 'false';
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
  delete process.env['TRON_MODE'];
  delete process.env['ENABLE_LIVE_TRON_WITHDRAWALS'];
});

describe('withdrawal routes (live Tron mode, withdrawals disabled)', () => {
  it('blocks withdrawals when fee resources are insufficient by default', async () => {
    repo.updateAccount({ cashBalance: 500, equity: 500 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/withdrawals',
      payload: { amount: 100, destinationAddress: TRON_ADDRESS, confirmed: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/fund the hot wallet with TRX or energy/);

    // Nothing was created or debited.
    expect(repo.listWithdrawals(10).length).toBe(0);
    expect(repo.getAccount().cashBalance).toBe(500);
  });
});

describe('withdrawal routes (live Tron mode, insufficient fee allowed)', () => {
  it('records the withdrawal as PENDING_FEE when the override flag is set', async () => {
    vi.resetModules();
    process.env['DB_PATH'] = dbPath;
    process.env['TRON_MODE'] = 'MAINNET';
    process.env['ENABLE_LIVE_TRON_WITHDRAWALS'] = 'false';
    process.env['ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT'] = 'true';
    const freshConnection = await import('../src/db/connection.js');
    freshConnection.closeDb();
    freshConnection.initDb();
    const repo2 = await import('../src/db/repositories.js');
    repo2.updateAccount({ cashBalance: 500, equity: 500 });

    const { withdrawalRoutes } = await import('../src/routes/withdrawalRoutes.js');
    const app2 = Fastify();
    await app2.register(withdrawalRoutes, { prefix: '/api' });

    const res = await app2.inject({
      method: 'POST',
      url: '/api/withdrawals',
      payload: { amount: 100, destinationAddress: TRON_ADDRESS, confirmed: true },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.withdrawal.status).toBe('PENDING_FEE');
    expect(body.withdrawal.feeEstimateTrx).toBeGreaterThan(0);
    expect(body.withdrawal.feePayer).toBe('HOT_WALLET');
    expect(body.message).toMatch(/live Tron withdrawals are disabled/);
    expect(repo2.getAccount().cashBalance).toBe(500);
    await app2.close();
    delete process.env['ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT'];
  });
});
