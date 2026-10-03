import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 7 acceptance test — full app (buildApp) running in TESTNET mode on the
 * Shasta test network. Covers: account/wallet, classic options, binary
 * options, AI binary gating, Tron testnet status (stubbed prober), the health
 * posture and the disabled-by-default admin API. No real network calls: the
 * live feed and the Tron prober are stubbed.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-phase7-test-'));

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let connection: typeof import('../src/db/connection.js');
let price = 67_000;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  process.env['TRADING_MODE'] = 'TESTNET';
  process.env['TRON_MODE'] = 'SHASTA';
  process.env['TRON_NETWORK_NAME'] = 'Shasta Testnet';
  process.env['TRON_EXPLORER_URL'] = 'https://shasta.tronscan.org';
  process.env['TRON_DEPOSIT_ADDRESS'] = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj0t';
  process.env['TRON_USDC_CONTRACT_ADDRESS'] = 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs';

  // Deterministic live feed (no network).
  const live = await import('../src/market/liveMarketDataService.js');
  vi.spyOn(live.liveMarket, 'start').mockImplementation(() => undefined);
  vi.spyOn(live.liveMarket, 'getLatestTick').mockImplementation(
    (): PriceTick => ({ price, timestamp: new Date().toISOString(), source: 'STUB' }),
  );
  // Binary settlement needs a tick at/after expiry — serve the current price.
  vi.spyOn(live.liveMarket, 'getTickAtOrAfter').mockImplementation(
    (timestampIso: string): PriceTick => ({ price, timestamp: timestampIso, source: 'STUB' }),
  );

  connection = await import('../src/db/connection.js');
  // Stubbed real-network prober: Shasta is "up" with fee resources funded.
  const tronStatus = await import('../src/services/tronStatusService.js');
  tronStatus.setTronProber(async () => ({
    trxBalance: 120.5,
    energyAvailable: 70_000,
    bandwidthAvailable: 1_200,
    latestBlock: 12_345_678,
  }));

  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  const tronStatus = await import('../src/services/tronStatusService.js');
  tronStatus.setTronProber(null);
  vi.restoreAllMocks();
  for (const name of ['DB_PATH', 'TRADING_MODE', 'TRON_MODE', 'TRON_NETWORK_NAME', 'TRON_EXPLORER_URL', 'TRON_DEPOSIT_ADDRESS', 'TRON_USDC_CONTRACT_ADDRESS']) {
    delete process.env[name];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});


describe('Phase 7 integration — TESTNET on Shasta', () => {
  it('reports a probed, connected testnet status (banner data for the UI)', async () => {
    // Real probe path (stubbed prober stands in for TronGrid).
    const health = await app.inject({ method: 'GET', url: '/api/tron/health' });
    expect(health.statusCode).toBe(200);

    const status = (await app.inject({ method: 'GET', url: '/api/tron/status' })).json();
    expect(status.tradingMode).toBe('TESTNET');
    expect(status.mode).toBe('SHASTA');
    expect(status.isTestnet).toBe(true);
    expect(status.networkName).toBe('Shasta Testnet');
    expect(status.explorerUrl).toBe('https://shasta.tronscan.org');
    expect(status.latestBlock).toBe(12_345_678);
    expect(status.connectionStatus).toBe('CONNECTED');
    // Deposits/trading ready; withdrawals stay blocked (no live withdrawals in TESTNET).
    expect(status.readiness).toBe('WITHDRAWAL_BLOCKED');
    expect(status.trxBalance).toBe(120.5);
    expect(status.energyAvailable).toBe(70_000);
  });

  it('drops to TRADE_BLOCKED when the prober reports the network down', async () => {
    const tronStatus = await import('../src/services/tronStatusService.js');
    try {
      tronStatus.setTronProber(async () => {
        throw new Error('connection refused');
      });
      await tronStatus.probeTronNetwork();
      const status = (await app.inject({ method: 'GET', url: '/api/tron/status' })).json();
      expect(status.connectionStatus).toBe('DISCONNECTED');
      expect(status.readiness).toBe('TRADE_BLOCKED');
      expect(status.warnings.some((w: string) => w.includes('Tron network unreachable'))).toBe(true);
    } finally {
      // Restore the healthy prober for the remaining tests.
      tronStatus.setTronProber(async () => ({
        trxBalance: 120.5,
        energyAvailable: 70_000,
        bandwidthAvailable: 1_200,
        latestBlock: 12_345_679,
      }));
      await tronStatus.probeTronNetwork();
    }
  });

  it('wallet: paper deposit/withdraw work on the test ledger in TESTNET', async () => {
    const deposit = await app.inject({ method: 'POST', url: '/api/paper/deposit', payload: { amount: 1000 } });
    expect(deposit.statusCode).toBe(201);
    const withdraw = await app.inject({ method: 'POST', url: '/api/paper/withdraw', payload: { amount: 200 } });
    expect(withdraw.statusCode).toBe(201);
    const balances = (await app.inject({ method: 'GET', url: '/api/paper/balances' })).json();
    expect(balances.cashBalance).toBe(800);
    expect(balances.equity).toBe(800);
  });

  it('deposits: a simulated USDC deposit is credited on the test ledger', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/deposits/simulate', payload: { amount: 50 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().deposit.txid).toMatch(/^sim-/);
    expect(res.json().account.cashBalance).toBe(850);
    const deposits = (await app.inject({ method: 'GET', url: '/api/deposits' })).json();
    expect(deposits.length).toBeGreaterThan(0);
  });

  it('fees: a simulated TRX fee deposit is accepted in TESTNET', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tron/simulate-trx-deposit', payload: { amountTrx: 25 } });
    expect(res.statusCode).toBe(200);
    const status = (await app.inject({ method: 'GET', url: '/api/tron/fee-status' })).json();
    // Real-network mode: the reserve comes from the probed on-chain balance.
    expect(status.trxBalance).toBe(120.5);
    expect(status.sufficientFeeReserve).toBe(true);
  });

  it('classic options: open locks only the stake on the internal ledger', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/classic/trading/start' })).statusCode).toBe(200);
    const opened = await app.inject({
      method: 'POST',
      url: '/api/options/open',
      payload: { side: 'CALL', stakeUsd: 10, durationSeconds: 600 },
    });
    expect(opened.statusCode).toBe(201);
    const account = (await app.inject({ method: 'GET', url: '/api/account' })).json().account;
    expect(account.lockedBalance).toBe(10);
    expect(account.cashBalance).toBe(840);
  });

  it('binary options: open and settle on the internal ledger in TESTNET', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { asset: 'BTC/USDC', direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });
    expect(opened.statusCode).toBe(201);
    const contractId = opened.json().id;

    // Force expiry; price rises → WIN settles via the real 1 s scheduler.
    connection
      .getDb()
      .prepare('UPDATE binary_contracts SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), contractId);
    price = 67_500;
    await vi.waitFor(
      async () => {
        const history = (await app.inject({ method: 'GET', url: '/api/binary/history' })).json();
        expect(
          history.some((c: { id: number; result: string }) => c.id === contractId && c.result === 'WIN'),
        ).toBe(true);
      },
      { timeout: 5000, interval: 250 },
    );
    await app.inject({ method: 'POST', url: '/api/classic/trading/stop' });
  }, 10_000);

  it('AI binary: AUTO_EXECUTE is allowed in TESTNET (only LIVE is gated)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/binary-ai/settings',
      payload: { mode: 'AUTO_EXECUTE' },
    });
    expect(res.statusCode).toBe(200);
    const status = (await app.inject({ method: 'GET', url: '/api/binary-ai/status' })).json();
    expect(status.mode).toBe('AUTO_EXECUTE');
    await app.inject({ method: 'PUT', url: '/api/binary-ai/settings', payload: { mode: 'SIGNAL_ONLY' } });
  });

  it('health exposes the safety posture without secrets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'ok',
      mode: 'TESTNET',
      tronMode: 'SHASTA',
      liveTronWithdrawalsEnabled: false,
      binaryLiveTradingEnabled: false,
      aiBinaryLiveAutoTradingEnabled: false,
      adminApiEnabled: false,
      database: 'ok',
    });
    expect(res.body.toLowerCase()).not.toContain('private');
  });

  it('admin API is 404 by default (ENABLE_ADMIN_API unset)', async () => {
    for (const [method, url] of [
      ['GET', '/api/admin/uat-verify'],
      ['POST', '/api/admin/uat-reset'],
    ] as const) {
      const res = await app.inject({ method, url, payload: { confirm: 'YES' } });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

