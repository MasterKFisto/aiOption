import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-trx-fee-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { tronRoutes } = await import('../src/routes/tronRoutes.js');
  const { walletRecordsRoutes } = await import('../src/routes/walletRecordsRoutes.js');
  connection.initDb();
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: true,
    startingEquity: 500,
  });

  app = Fastify();
  await app.register(tronRoutes, { prefix: '/api' });
  await app.register(walletRecordsRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('TRX fee wallet endpoints', () => {
  it('GET /api/tron/fee-deposit-info returns the fee wallet details', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tron/fee-deposit-info' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.asset).toBe('TRX');
    expect(body.network).toBe('TRON');
    expect(body.purpose).toBe('network fee reserve');
    expect(body.feeWalletAddress).toBeTruthy();
    expect(body.warning).toContain('not credited as USDT trading balance');
  });

  it('reports an insufficient fee reserve before any TRX deposit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tron/fee-status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trxBalance).toBe(0);
    expect(body.sufficientFeeReserve).toBe(false);
    expect(body.estimatedWithdrawalsSupported).toBe(0);
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('simulated TRX deposits update the reserve without touching USDT', async () => {
    const before = repo.getAccount();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tron/simulate-trx-deposit',
      payload: { amountTrx: 100 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trxBalance).toBe(100);
    expect(body.sufficientFeeReserve).toBe(true);
    expect(body.estimatedWithdrawalsSupported).toBe(3); // floor(100 / 30)

    // USDT trading balance untouched — TRX is a separate reserve.
    expect(repo.getAccount().cashBalance).toBe(before.cashBalance);

    const deposits = await app.inject({ method: 'GET', url: '/api/tron/fee-deposits' });
    const list = deposits.json() as Array<{ amountTrx: number; status: string; asset: string }>;
    expect(list.length).toBe(1);
    expect(list[0]!.amountTrx).toBe(100);
    expect(list[0]!.status).toBe('CREDITED');
    expect(list[0]!.asset).toBe('TRX');
  });

  it('rejects invalid simulated deposit bodies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tron/simulate-trx-deposit',
      payload: { amountTrx: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('shows TRX fee deposits separately in wallet records', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/wallet/records?type=FEE_DEPOSIT&limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records.length).toBeGreaterThanOrEqual(1);
    const record = body.records[0] as { kind: string; asset: string; amount: number };
    expect(record.kind).toBe('FEE_DEPOSIT');
    expect(record.asset).toBe('TRX');
    expect(record.amount).toBeGreaterThan(0);
  });
});
