import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-phase64-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

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

  app = Fastify();
  await app.register(tronRoutes, { prefix: '/api' });
  await app.register(walletRecordsRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Tron status endpoints', () => {
  it('GET /api/tron/status returns the full status shape (no secrets)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tron/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('SIMULATED');
    expect(body.networkName).toBe('Simulated');
    expect(body.connectionStatus).toBe('CONNECTED');
    expect(body.readyToTrade).toBe(true);
    expect(body.depositAddress).toBeTruthy();
    expect(Array.isArray(body.warnings)).toBe(true);
    // Private keys must never be exposed.
    expect(JSON.stringify(body)).not.toContain('PRIVATE');
    expect(JSON.stringify(body)).not.toMatch(/privateKey/i);
  });

  it('GET /api/tron/health checks connectivity and records it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tron/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.healthy).toBe(true);
    expect(body.status.lastCheckedAt).toBeTruthy();

    const checks = connection
      .getDb()
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM tron_status_checks')
      .get();
    expect(checks?.count).toBe(1);
  });

  it('GET /api/tron/fee-estimate returns simulated fee estimates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tron/fee-estimate?amount=10&destination=${TRON_ADDRESS}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.network).toBe('TRON');
    expect(body.asset).toBe('USDT');
    expect(body.estimatedFeeTrx).toBe(30);
    expect(body.estimatedFeeUsd).toBeCloseTo(3.6, 1);
    expect(body.feePayer).toBe('HOT_WALLET');
    expect(body.sufficientFeeResources).toBe(true);
  });

  it('rejects an invalid destination in the fee estimate', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tron/fee-estimate?amount=10&destination=NOT_AN_ADDRESS',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('wallet records endpoints', () => {
  it('GET /api/wallet/records unifies transactions, deposits and withdrawals', async () => {
    repo.logTransaction({ type: 'DEPOSIT', amount: 100, currency: 'USDT', description: 'test', positionId: null });
    repo.createDeposit({ amount: 25, status: 'CONFIRMED', txid: 'dep-tx-1' });
    repo.createWithdrawal({
      amount: 10,
      destinationAddress: TRON_ADDRESS,
      status: 'SIMULATED',
      txid: 'sim-1',
      feeEstimateTrx: 30,
      feeEstimateUsd: 3.6,
      feePayer: 'HOT_WALLET',
    });

    const res = await app.inject({ method: 'GET', url: '/api/wallet/records?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records.length).toBeGreaterThanOrEqual(3);
    expect(body.summary.availableBalance).toBeDefined();
    expect(body.summary.hotWalletTrxBalance).toBeGreaterThan(0);

    const withdrawal = body.records.find((r: { id: string }) => r.id.startsWith('wd-'));
    expect(withdrawal.kind).toBe('WITHDRAWAL');
    expect(withdrawal.amount).toBe(-10);
    expect(withdrawal.feeEstimateTrx).toBe(30);
    expect(withdrawal.feePaidBy).toBe('HOT_WALLET');
  });

  it('filters records by kind', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/wallet/records?type=WITHDRAWAL' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const record of body.records) {
      expect(record.kind).toBe('WITHDRAWAL');
    }
  });

  it('GET /api/wallet/records/:id returns a single record or 404', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/wallet/records?limit=50' });
    const first = all.json().records[0] as { id: string };
    const res = await app.inject({ method: 'GET', url: `/api/wallet/records/${first.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(first.id);

    const missing = await app.inject({ method: 'GET', url: '/api/wallet/records/tx-999999' });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects an invalid type filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/wallet/records?type=BOGUS' });
    expect(res.statusCode).toBe(400);
  });
});
