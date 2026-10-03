import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-wallet-address-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

// Real mainnet addresses with valid Base58Check checksums (verified with TronWeb.isAddress).
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const OTHER_VALID = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
const BAD_CHECKSUM = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u';

let app: ReturnType<typeof Fastify>;
let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { walletAddressRoutes } = await import('../src/routes/walletAddressRoutes.js');
  const { depositRoutes } = await import('../src/routes/depositRoutes.js');
  const { tronRoutes } = await import('../src/routes/tronRoutes.js');
  connection.initDb();
  app = Fastify();
  await app.register(walletAddressRoutes, { prefix: '/api' });
  await app.register(depositRoutes, { prefix: '/api' });
  await app.register(tronRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  connection
    .getDb()
    .prepare(
      "DELETE FROM app_settings WHERE key IN ('usdt_trade_address','withdrawal_destination_address','trx_fee_wallet_address')",
    )
    .run();
});

const put = (payload: unknown) =>
  app.inject({ method: 'PUT', url: '/api/wallet/addresses', payload: payload as object });
const get = async () => (await app.inject({ method: 'GET', url: '/api/wallet/addresses' })).json();
const validate = async (address: unknown) =>
  app.inject({ method: 'POST', url: '/api/wallet/addresses/validate', payload: { address } as object });

describe('Tron address validation (POST /api/wallet/addresses/validate)', () => {
  it('accepts valid checksummed addresses', async () => {
    for (const address of [USDT_CONTRACT, OTHER_VALID]) {
      expect((await validate(address)).json()).toEqual({ valid: true, addressType: 'TRON' });
    }
  });

  it('rejects empty, wrong prefix, wrong length, non-Base58 and bad checksum', async () => {
    const cases: Array<[string, RegExp]> = [
      ['', /required/],
      ['0x742d35Cc6634C0532925a3b844Bc454e4438f44e', /start with "T"/],
      ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6', /34 characters/],
      ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj0t', /Base58/],
      [BAD_CHECKSUM, /checksum/],
      ['TSimulatedAiOptionDepositAddressUSDT1', /34 characters/],
    ];
    for (const [address, reason] of cases) {
      const body = (await validate(address)).json();
      expect(body.valid, address).toBe(false);
      expect(body.reason, address).toMatch(reason);
    }
  });

  it('bounds the payload size and type', async () => {
    expect((await validate('T'.repeat(10_000))).statusCode).toBe(400);
    expect((await validate(12345)).statusCode).toBe(400);
  });
});

describe('GET/PUT /api/wallet/addresses', () => {
  it('defaults to the simulated placeholder (source SIMULATED, flagged as not valid)', async () => {
    const body = await get();
    expect(body.usdtTradeAddressSource).toBe('SIMULATED');
    expect(body.validationStatus.usdtTradeAddress.valid).toBe(false);
    expect(body.withdrawalDestinationAddressSource).toBe('NOT_SET');
    expect(body.updatedAt).toBeNull();
  });

  it('saves a valid trade address and deposit / tron status / fee info use it', async () => {
    const res = await put({ usdtTradeAddress: `  ${USDT_CONTRACT}  ` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      usdtTradeAddress: USDT_CONTRACT,
      usdtTradeAddressSource: 'DATABASE',
      effectiveWithdrawalDestinationAddress: USDT_CONTRACT,
    });
    expect(res.json().validationStatus.usdtTradeAddress.valid).toBe(true);
    expect(res.json().updatedAt).toBeTruthy();
    expect(repo.getAppSetting('usdt_trade_address')?.value).toBe(USDT_CONTRACT);

    const deposit = (await app.inject({ method: 'GET', url: '/api/deposits/info' })).json();
    expect(deposit).toMatchObject({ address: USDT_CONTRACT, addressSource: 'DATABASE' });
    const tron = (await app.inject({ method: 'GET', url: '/api/tron/status' })).json();
    expect(tron).toMatchObject({ depositAddress: USDT_CONTRACT, depositAddressSource: 'DATABASE' });

    expect(repo.listSettingsAudit(5)[0]).toMatchObject({
      key: 'usdt_trade_address',
      newValue: USDT_CONTRACT,
    });
  });

  it('withdrawal destination and TRX fee wallet can be set and cleared', async () => {
    await put({
      usdtTradeAddress: USDT_CONTRACT,
      withdrawalDestinationAddress: OTHER_VALID,
      trxFeeWalletAddress: OTHER_VALID,
    });
    let body = await get();
    expect(body.effectiveWithdrawalDestinationAddress).toBe(OTHER_VALID);
    expect(body.trxFeeWalletAddressSource).toBe('DATABASE');
    const fee = (await app.inject({ method: 'GET', url: '/api/tron/fee-deposit-info' })).json();
    expect(fee.feeWalletAddress).toBe(OTHER_VALID);

    await put({ withdrawalDestinationAddress: '' });
    body = await get();
    expect(body.withdrawalDestinationAddressSource).toBe('NOT_SET');
    expect(body.effectiveWithdrawalDestinationAddress).toBe(USDT_CONTRACT);
  });

  it('rejects invalid addresses atomically (nothing is saved)', async () => {
    const res = await put({ usdtTradeAddress: OTHER_VALID, trxFeeWalletAddress: BAD_CHECKSUM });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('trxFeeWalletAddress');
    expect(res.json().reason).toMatch(/checksum/);
    expect(repo.getAppSetting('usdt_trade_address')).toBeNull();
  });

  it('rejects unknown fields, empty bodies, non-strings and injection attempts', async () => {
    const cases: unknown[] = [
      {},
      { usdtTradeAddress: 123 },
      { privateKey: 'abc' },
      { usdtTradeAddress: "T'; DROP TABLE app_settings;--aaaaaaaaaaaaaaaa" },
      { usdtTradeAddress: '<script>alert(1)</script>' },
    ];
    for (const payload of cases) {
      expect((await put(payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(
      connection.getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get(),
    ).toBeTruthy();
  });

  it('never exposes secrets in address responses', async () => {
    await put({ usdtTradeAddress: USDT_CONTRACT });
    const text = JSON.stringify(await get());
    expect(text).not.toMatch(/private|secret|mnemonic|seed/i);
  });
});

