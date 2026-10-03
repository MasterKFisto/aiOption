import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 7: admin UAT-reset API with ENABLE_ADMIN_API=true (TESTNET/Shasta).
 * The default-disabled 404 behaviour is covered in phase7Integration.test.ts.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-admin-api-test-'));

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  process.env['TRADING_MODE'] = 'TESTNET';
  process.env['TRON_MODE'] = 'SHASTA';
  process.env['ENABLE_ADMIN_API'] = 'true';
  process.env['AI_BINARY_ENABLED'] = 'true';

  const live = await import('../src/market/liveMarketDataService.js');
  vi.spyOn(live.liveMarket, 'start').mockImplementation(() => undefined);
  vi.spyOn(live.liveMarket, 'getLatestTick').mockImplementation(
    (): PriceTick => ({ price: 67_000, timestamp: new Date().toISOString(), source: 'STUB' }),
  );

  connection = await import('../src/db/connection.js');
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  vi.restoreAllMocks();
  for (const name of ['DB_PATH', 'TRADING_MODE', 'TRON_MODE', 'ENABLE_ADMIN_API', 'AI_BINARY_ENABLED']) {
    delete process.env[name];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});


describe('admin UAT API (enabled)', () => {
  it('rejects a reset without the YES confirmation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/uat-reset',
      payload: { startingBalanceUsdc: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('resets all data and seeds the starting balance, then verifies clean', async () => {
    // Seed activity: simulated deposit + enabled trading.
    const deposit = await app.inject({ method: 'POST', url: '/api/deposits/simulate', payload: { amount: 250 } });
    expect(deposit.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/classic/trading/start' });
    const before = (await app.inject({ method: 'GET', url: '/api/account' })).json().account;
    expect(before.cashBalance).toBe(250);
    expect(before.tradingEnabled).toBe(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/uat-reset',
      payload: { confirm: 'YES', startingBalanceUsdc: 1000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.startingBalanceUsdc).toBe(1000);
    expect(body.verification.ok).toBe(true);

    const account = (await app.inject({ method: 'GET', url: '/api/account' })).json().account;
    expect(account.cashBalance).toBe(1000);
    expect(account.equity).toBe(1000);
    expect(account.tradingEnabled).toBe(false);
    expect(account.lockedBalance).toBe(0);

    const deposits = (await app.inject({ method: 'GET', url: '/api/deposits' })).json();
    expect(deposits).toEqual([]);

    const verify = (await app.inject({ method: 'GET', url: '/api/admin/uat-verify' })).json();
    expect(verify.ok).toBe(true);
    expect(verify.counts.deposits).toBe(0);
    expect(verify.counts.account).toBe(1);
  });

  it('health reflects the enabled admin API', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(body.adminApiEnabled).toBe(true);
    expect(body.mode).toBe('TESTNET');
  });
});
