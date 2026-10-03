import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-trx-security-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

const CONFIGURED_FEE_WALLET = 'TCustomFeeWalletAddressForTesting0001';

let app: ReturnType<typeof Fastify>;
let connection: typeof import('../src/db/connection.js');
let getFeeDepositInfo: typeof import('../src/services/tronFeeWalletService.js')['getFeeDepositInfo'];
let getFeeReserveStatus: typeof import('../src/services/tronFeeWalletService.js')['getFeeReserveStatus'];

/**
 * Runs under a NON-paper, NON-simulated configuration so the simulated-deposit
 * gating and the configured-fee-wallet paths are exercised.
 */
beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  // Phase 7: TESTNET requires a test network (SHASTA/NILE), so this non-paper,
  // non-simulated scenario runs as LIVE+MAINNET with the mandatory confirms.
  process.env['TRADING_MODE'] = 'LIVE';
  process.env['LIVE_MODE_CONFIRM'] = 'I_UNDERSTAND_REAL_FUNDS';
  process.env['TRON_MODE'] = 'MAINNET';
  process.env['TRON_FEE_WALLET_ADDRESS'] = CONFIGURED_FEE_WALLET;
  process.env['TRON_ACCEPT_TRX_DEPOSITS'] = 'false';
  connection = await import('../src/db/connection.js');
  const { tronRoutes } = await import('../src/routes/tronRoutes.js');
  getFeeDepositInfo = (await import('../src/services/tronFeeWalletService.js')).getFeeDepositInfo;
  getFeeReserveStatus = (await import('../src/services/tronFeeWalletService.js')).getFeeReserveStatus;
  connection.initDb();

  app = Fastify();
  await app.register(tronRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('TRX fee wallet security (non-paper, non-simulated)', () => {
  it('blocks the simulated TRX deposit endpoint with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tron/simulate-trx-deposit',
      payload: { amountTrx: 100 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/paper\/testnet\/simulated mode/);
  });

  it('uses the configured fee wallet address and honors acceptTrxDeposits=false', () => {
    const info = getFeeDepositInfo();
    expect(info.feeWalletAddress).toBe(CONFIGURED_FEE_WALLET);
    expect(info.sameAddressAsDeposit).toBe(false);
    expect(info.acceptTrxDeposits).toBe(false);
    expect(info.warning).toContain('not credited as USDT trading balance');
  });

  it('reports insufficient reserve with a warning when TRX deposits are disabled', () => {
    const status = getFeeReserveStatus();
    expect(status.trxBalance).toBe(0);
    expect(status.sufficientFeeReserve).toBe(false);
    expect(status.estimatedWithdrawalsSupported).toBe(0);
    expect(status.warnings.some((w) => w.includes('disabled by configuration'))).toBe(true);
    expect(status.warnings.some((w) => w.includes('below the 50 minimum'))).toBe(true);
  });

  it('never exposes secrets in the fee endpoints', async () => {
    for (const url of ['/api/tron/fee-deposit-info', '/api/tron/fee-status', '/api/tron/fee-deposits']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body.toLowerCase()).not.toContain('private');
      expect(res.body.toLowerCase()).not.toContain('secret');
    }
  });
});
