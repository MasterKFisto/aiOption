import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 7.1: USDT is the base currency (USDC is no longer supported on Tron).
 * Covers the startup guard, account/deposit/withdrawal/fee asset reporting,
 * the shared constants and the USDC→USDT data migration.
 */

/* ------------------------------ config guards ----------------------------- */

async function expectConfigFailure(): Promise<void> {
  vi.resetModules();
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
  await expect(import('../src/config.js')).rejects.toThrow('process.exit called');
  expect(exitSpy).toHaveBeenCalledWith(1);
}

describe('Phase 7.1 base-currency config', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env['BASE_CURRENCY'];
    delete process.env['TRON_USDT_CONTRACT_ADDRESS'];
  });

  it('defaults BASE_CURRENCY to USDT and accepts the renamed contract variable', async () => {
    delete process.env['BASE_CURRENCY'];
    vi.resetModules();
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = 'TTestUsdtTokenContractPhase71000000';
    const { config } = await import('../src/config.js');
    expect(config.BASE_CURRENCY).toBe('USDT');
    expect(config.TRON_USDT_CONTRACT_ADDRESS).toBe('TTestUsdtTokenContractPhase71000000');
    expect(config.MARKET_SYMBOL).toBe('BTC/USDT');
  });

  it('aborts with a clear deprecation error when BASE_CURRENCY=USDC', async () => {
    process.env['BASE_CURRENCY'] = 'USDC';
    await expectConfigFailure();
  });

  it('rejects any other unsupported base currency', async () => {
    process.env['BASE_CURRENCY'] = 'DAI';
    await expectConfigFailure();
  });
});

/* --------------------------- shared currency constants -------------------- */

describe('Phase 7.1 shared currency constants', () => {
  it('exposes USDT labels and the USDT-TEST testnet token naming', async () => {
    const shared = await import('@aioption/shared');
    expect(shared.BASE_CURRENCY_LABEL).toBe('USDT');
    expect(shared.BASE_CURRENCY_DECIMALS).toBe(6);
    expect(shared.TESTNET_TOKEN_SYMBOL).toBe('USDT-TEST');
    expect(shared.TESTNET_TOKEN_NAME).toBe('Tether USD Test');
    expect(shared.TESTNET_TOKEN_DECIMALS).toBe(6);
    expect(shared.TESTNET_ASSET_NOTICE).toContain('USDT-TEST');
    expect(shared.TRON_DEPOSIT_WARNING).toContain('USDT');
    expect(shared.TRON_DEPOSIT_WARNING).not.toContain('USDC');
  });
});

/* ------------------------- DB defaults + migration ------------------------ */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-usdt-test-'));

let connection: typeof import('../src/db/connection.js');

/** (Re)imports the connection module and runs migrations on the test DB. */
async function freshDb(): Promise<void> {
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  connection = await import('../src/db/connection.js');
  connection.initDb();
}

beforeAll(async () => {
  vi.resetModules();
  await freshDb();
});

afterAll(() => {
  connection.closeDb();
  delete process.env['DB_PATH'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Phase 7.1 database defaults', () => {
  // The config-guard suite above resets the module registry; rebind first.
  beforeAll(freshDb);

  it('seeds the account with base currency USDT', () => {
    const account = connection
      .getDb()
      .prepare('SELECT base_currency FROM account WHERE id = 1')
      .get() as { base_currency: string };
    expect(account.base_currency).toBe('USDT');
  });

  it('reports asset USDT on deposits, withdrawals and fee estimates', async () => {
    const repo = await import('../src/db/repositories.js');
    const deposit = repo.createDeposit({ amount: 25, status: 'CONFIRMED', txid: 'usdt-dep-1' });
    expect(deposit?.asset).toBe('USDT');
    expect(deposit?.network).toBe('TRON');
    expect(deposit?.tokenStandard).toBe('TRC20');

    const withdrawal = repo.createWithdrawal({
      amount: 10,
      destinationAddress: 'TTestnetWithdrawalAddress710000000',
      status: 'REQUESTED',
    });
    expect(withdrawal.asset).toBe('USDT');

    const { estimateWithdrawalFee } = await import('../src/services/tronStatusService.js');
    const fee = estimateWithdrawalFee('TTestnetWithdrawalAddress710000000');
    expect(fee).toMatchObject({ network: 'TRON', asset: 'USDT', tokenStandard: 'TRC20' });
  });

  it('deposit info endpoint reports asset USDT', async () => {
    const Fastify = (await import('fastify')).default;
    const { depositRoutes } = await import('../src/routes/depositRoutes.js');
    const app = Fastify();
    await app.register(depositRoutes, { prefix: '/api' });
    const res = await app.inject({ method: 'GET', url: '/api/deposits/info' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ network: 'TRON', asset: 'USDT', tokenStandard: 'TRC20' });
    await app.close();
  });
});

describe('Phase 7.1 USDC → USDT migration', () => {
  beforeAll(freshDb);

  it('converts existing USDC values, preserves everything else, and is idempotent', async () => {
    const db = connection.getDb();
    const { runMigrations } = await import('../src/db/migrations.js');
    const now = new Date().toISOString();

    // Seed a USDC-era state (as written before Phase 7.1).
    db.prepare("UPDATE account SET base_currency = 'USDC' WHERE id = 1").run();
    db.prepare(
      "INSERT INTO deposits (asset, amount, txid, status, confirmations, created_at) VALUES ('USDC', 42.5, 'legacy-dep', 'CONFIRMED', 12, ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO withdrawals (asset, amount, destination_address, status, created_at, updated_at) VALUES ('USDC', 7.25, 'TLegacyWithdrawalAddress000000000', 'COMPLETED', ?, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO transactions (type, amount, currency, description, created_at) VALUES ('DEPOSIT', 42.5, 'USDC', 'legacy', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO binary_contracts (asset, direction, stake_usd, payout_ratio, potential_profit_usd, total_return_if_win_usd, entry_price, opened_at, expires_at) VALUES ('BTC/USDC', 'UP', 10, 0.8, 8, 18, 67000, ?, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO positions (symbol, side, strike_price, expiry, quantity, entry_premium, opened_at, created_at) VALUES ('BTC/USDC', 'CALL', 67000, ?, 1, 10, ?, ?)",
    ).run(now, now, now);
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('usdc_trade_address', 'TLegacyTradeAddress000000000000', ?)").run(now);

    // Re-running migrations converts the legacy values in place.
    runMigrations(db);

    const account = db.prepare('SELECT base_currency FROM account WHERE id = 1').get() as { base_currency: string };
    expect(account.base_currency).toBe('USDT');
    const deposit = db.prepare("SELECT asset, amount, status FROM deposits WHERE txid = 'legacy-dep'").get() as Record<string, unknown>;
    expect(deposit).toMatchObject({ asset: 'USDT', amount: 42.5, status: 'CONFIRMED' });
    const withdrawal = db.prepare("SELECT asset, amount, status FROM withdrawals WHERE destination_address = 'TLegacyWithdrawalAddress000000000'").get() as Record<string, unknown>;
    expect(withdrawal).toMatchObject({ asset: 'USDT', amount: 7.25, status: 'COMPLETED' });
    const tx = db.prepare("SELECT currency FROM transactions WHERE description = 'legacy'").get() as { currency: string };
    expect(tx.currency).toBe('USDT');
    const contract = db.prepare('SELECT asset FROM binary_contracts').get() as { asset: string };
    expect(contract.asset).toBe('BTC/USDT');
    const position = db.prepare('SELECT symbol FROM positions').get() as { symbol: string };
    expect(position.symbol).toBe('BTC/USDT');
    // Settings key renamed, value carried over; old key gone; marker present.
    const migratedAddress = db.prepare("SELECT value FROM app_settings WHERE key = 'usdt_trade_address'").get() as { value: string };
    expect(migratedAddress.value).toBe('TLegacyTradeAddress000000000000');
    expect(db.prepare("SELECT COUNT(*) n FROM app_settings WHERE key = 'usdc_trade_address'").get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM app_settings WHERE key = 'migration_7_1_base_currency_usdt'").get()).toMatchObject({ n: 1 });

    // Idempotent: a second run changes nothing and never errors.
    runMigrations(db);
    const stillClean = db
      .prepare("SELECT COUNT(*) n FROM deposits WHERE asset = 'USDC'")
      .get() as { n: number };
    expect(stillClean.n).toBe(0);
  });
});
