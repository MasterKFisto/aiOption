import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Phase 7.4: USDT TRC20 token connection on the Nile Testnet.
 * - /api/tron/token-status with missing/invalid/unconfigured contracts
 * - token metadata + balances via an injected querier (no real network)
 * - symbol/decimals expectations and the known-mainnet-contract warning
 * - deposits/withdrawals record the token contract; unrecognized-token
 *   transfers are never credited
 */

/* --------------------------- test helpers --------------------------------- */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Builds a VALID base58check Tron address (0x41 + payload + checksum). */
function makeAddress(fill: number): string {
  const payload = Buffer.alloc(21, fill);
  payload[0] = 0x41;
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest()
    .subarray(0, 4);
  let value = BigInt(`0x${Buffer.concat([payload, checksum]).toString('hex')}`);
  let out = '';
  while (value > 0n) {
    out = B58[Number(value % 58n)] + out;
    value /= 58n;
  }
  return out;
}

const DEPOSIT_ADDRESS = makeAddress(1);
const HOT_WALLET_ADDRESS = makeAddress(2);
const TOKEN_CONTRACT = makeAddress(3);
const OTHER_CONTRACT = makeAddress(4);

/** ABI-encodes a string return value (dynamic string form). */
function abiString(value: string): string {
  const data = Buffer.from(value, 'utf8').toString('hex');
  const length = Buffer.byteLength(value, 'utf8').toString(16).padStart(64, '0');
  const padding = '0'.repeat((64 - (data.length % 64)) % 64);
  return `${'0'.repeat(62)}20${length}${data}${padding}`; // offset word = 0x20
}

function abiUint(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

type TokenQuerier = import('../src/services/tronTokenService.js').TokenQuerier;

/** Chain querier stub: a working USDT-TEST token with 250.5 in each wallet. */
function stubQuerier(overrides: Partial<TokenQuerier> = {}): TokenQuerier {
  return {
    probeRpc: async () => 12_345,
    contractExists: async () => true,
    callConstant: async (_contract, selector) => {
      if (selector === 'name()') return abiString('Tether USD Test');
      if (selector === 'symbol()') return abiString('USDT-TEST');
      if (selector === 'decimals()') return abiUint(6n);
      return abiUint(250_500_000n); // balanceOf → 250.5 at 6 decimals
    },
    trxBalance: async () => 42,
    ...overrides,
  };
}

/* --------------------------- module loading ------------------------------- */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-token-test-'));

const TOKEN_ENV_VARS = [
  'TRON_MODE',
  'TRON_DEPOSIT_ADDRESS',
  'TRON_HOT_WALLET_ADDRESS',
  'TRON_USDT_CONTRACT_ADDRESS',
  'TRON_USDT_ALLOW_TEST_TOKEN',
  'TRON_TOKEN_SIMULATE_CONNECTION',
] as const;

let connection: typeof import('../src/db/connection.js');
let tokenService: typeof import('../src/services/tronTokenService.js');

/** Re-imports config + DB + token service with the current env (fresh state). */
async function loadTokenModules(): Promise<void> {
  vi.resetModules();
  connection = await import('../src/db/connection.js');
  connection.initDb();
  tokenService = await import('../src/services/tronTokenService.js');
}

beforeAll(async () => {
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  await loadTokenModules();
});

afterEach(() => {
  tokenService.setTokenQuerier(null);
  tokenService.resetTokenStatusCache();
  for (const name of TOKEN_ENV_VARS) {
    delete process.env[name];
  }
});

afterAll(() => {
  connection.closeDb();
  delete process.env['DB_PATH'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------------ token status ------------------------------ */

describe('Phase 7.4 token status', () => {
  it('reports TOKEN_CONTRACT_MISSING with a clear warning when no contract is set', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_DEPOSIT_ADDRESS'] = DEPOSIT_ADDRESS;
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier());

    const status = await tokenService.testTokenConnection();
    expect(status.tronMode).toBe('NILE');
    expect(status.rpcConnected).toBe(true);
    expect(status.tokenConfigured).toBe(false);
    expect(status.tokenConnected).toBe(false);
    expect(status.errors).toContain('TOKEN_CONTRACT_MISSING');
    expect(status.warnings).toContain('USDT token contract is not configured.');
    expect(status.lastCheckedAt).toBeTruthy();
  });

  it('reports TOKEN_CONTRACT_INVALID for a malformed contract address', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = 'not-a-tron-address';
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier());

    const status = await tokenService.testTokenConnection();
    expect(status.errors).toContain('TOKEN_CONTRACT_INVALID');
    expect(status.tokenConnected).toBe(false);
  });

  it('reports TRON_RPC_UNREACHABLE when the RPC probe fails', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier({ probeRpc: async () => Promise.reject(new Error('offline')) }));

    const status = await tokenService.testTokenConnection();
    expect(status.rpcConnected).toBe(false);
    expect(status.errors).toContain('TRON_RPC_UNREACHABLE');
    expect(status.tokenConnected).toBe(false);
  });

  it('reports TOKEN_CONTRACT_NOT_FOUND when the address holds no contract', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier({ contractExists: async () => false }));

    const status = await tokenService.testTokenConnection();
    expect(status.errors).toContain('TOKEN_CONTRACT_NOT_FOUND');
    expect(status.tokenConnected).toBe(false);
  });

  it('reports DEPOSIT_ADDRESS_INVALID for a malformed configured deposit address', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_DEPOSIT_ADDRESS'] = 'TInvalidDepositAddress';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier());

    const status = await tokenService.testTokenConnection();
    expect(status.errors).toContain('DEPOSIT_ADDRESS_INVALID');
  });

  it('connects: metadata, balances and the test-token symbol warning', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_DEPOSIT_ADDRESS'] = DEPOSIT_ADDRESS;
    process.env['TRON_HOT_WALLET_ADDRESS'] = HOT_WALLET_ADDRESS;
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier());

    const status = await tokenService.testTokenConnection();
    expect(status.tokenConnected).toBe(true);
    expect(status.errors).toEqual([]);
    expect(status.tokenName).toBe('Tether USD Test');
    expect(status.tokenSymbol).toBe('USDT-TEST');
    expect(status.tokenDecimals).toBe(6);
    expect(status.depositTokenBalance).toBe('250.5');
    expect(status.hotWalletTokenBalance).toBe('250.5');
    expect(status.hotWalletTrxBalance).toBe('42');
    // USDT-TEST ≠ USDT — accepted because TRON_USDT_ALLOW_TEST_TOKEN=true.
    expect(status.warnings.some((w) => w.includes('TOKEN_SYMBOL_MISMATCH'))).toBe(true);
    expect(status.tokenContractSource).toBe('ENVIRONMENT');
  });

  it('blocks on symbol mismatch when TRON_USDT_ALLOW_TEST_TOKEN=false', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    process.env['TRON_USDT_ALLOW_TEST_TOKEN'] = 'false';
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier());

    const status = await tokenService.testTokenConnection();
    expect(status.errors).toContain('TOKEN_SYMBOL_MISMATCH');
    expect(status.tokenConnected).toBe(false);
  });

  it('warns on decimals mismatch and uses the contract decimals', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    await loadTokenModules();
    tokenService.setTokenQuerier(
      stubQuerier({
        callConstant: async (_c, selector) => {
          if (selector === 'name()') return abiString('Odd Token');
          if (selector === 'symbol()') return abiString('USDT');
          if (selector === 'decimals()') return abiUint(8n);
          return abiUint(2_500_000_000n); // 25 at 8 decimals
        },
      }),
    );

    const status = await tokenService.testTokenConnection();
    expect(status.tokenDecimals).toBe(8);
    expect(status.depositTokenBalance).toBeNull(); // no deposit address configured here
    expect(status.warnings.some((w) => w.includes('TOKEN_DECIMALS_MISMATCH'))).toBe(true);
  });

  it('warns strongly when a known MAINNET token contract is used on Nile', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // mainnet USDT
    await loadTokenModules();
    tokenService.setTokenQuerier(stubQuerier());

    const status = await tokenService.testTokenConnection();
    expect(status.warnings.some((w) => w.includes('MAINNET'))).toBe(true);
  });

  it('returns simulated token info when TRON_TOKEN_SIMULATE_CONNECTION=true', async () => {
    process.env['TRON_TOKEN_SIMULATE_CONNECTION'] = 'true'; // TRON_MODE defaults to SIMULATED
    await loadTokenModules();

    const status = await tokenService.testTokenConnection();
    expect(status.simulated).toBe(true);
    expect(status.tokenConnected).toBe(true);
    expect(status.tokenSymbol).toBe('USDT-TEST');
    expect(status.tokenName).toBe('Tether USD Test');
    expect(status.warnings.some((w) => w.includes('Simulated token connection'))).toBe(true);
  });

  // Phase 7.4.1 hotfix: with NO injected querier and an unreachable RPC, the
  // service must return a controlled diagnostic — never throw (never a 500).
  it('never throws when the default querier cannot reach the RPC (controlled diagnostic)', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_RPC_URL'] = 'https://127.0.0.1:9'; // nothing listens there
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT;
    await loadTokenModules();

    const status = await tokenService.getTokenStatus(true);
    expect(status.rpcConnected).toBe(false);
    expect(status.errors).toContain('TRON_RPC_UNREACHABLE');
    expect(status.tokenConnected).toBe(false);
    expect(status.lastCheckedAt).toBeTruthy();
    delete process.env['TRON_RPC_URL'];
  });
});

/* ------------------- deposits / withdrawals contract tracking -------------- */

describe('Phase 7.4 deposit + withdrawal token contract tracking', () => {
  it('records the token contract on deposits and withdrawals', async () => {
    await loadTokenModules();
    const { createDeposit, createWithdrawal, listDeposits, listWithdrawals } = await import(
      '../src/db/repositories.js'
    );
    const deposit = createDeposit({
      amount: 25,
      txid: `dep-${Date.now()}`,
      status: 'CONFIRMED',
      tokenContractAddress: TOKEN_CONTRACT,
    });
    expect(deposit?.tokenContractAddress).toBe(TOKEN_CONTRACT);
    expect(listDeposits(10)[0]?.tokenContractAddress).toBe(TOKEN_CONTRACT);

    const withdrawal = createWithdrawal({
      amount: 5,
      destinationAddress: DEPOSIT_ADDRESS,
      status: 'REQUESTED',
      tokenContractAddress: TOKEN_CONTRACT,
    });
    expect(withdrawal.tokenContractAddress).toBe(TOKEN_CONTRACT);
    expect(listWithdrawals(10)[0]?.tokenContractAddress).toBe(TOKEN_CONTRACT);
  });

  it('credits configured-contract transfers and skips unrecognized token contracts', async () => {
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = TOKEN_CONTRACT; // SIMULATED mode
    await loadTokenModules();
    const { tronService, SimulatedTronService } = await import('../src/services/tronService.js');
    const depositSync = await import('../src/services/depositSyncService.js');
    const { listDeposits, getAccount } = await import('../src/db/repositories.js');
    expect(tronService).toBeInstanceOf(SimulatedTronService);
    const sim = tronService as InstanceType<typeof SimulatedTronService>;

    const before = getAccount().cashBalance;
    // Matching contract → credited; mismatched contract → skipped (never credited).
    sim.simulateIncomingUsdt(10, undefined, TOKEN_CONTRACT);
    sim.simulateIncomingUsdt(5, undefined, OTHER_CONTRACT);
    const credited = await depositSync.syncDepositsOnce();

    expect(credited).toBe(1);
    expect(getAccount().cashBalance).toBeCloseTo(before + 10, 6);
    // Only this test's sim transfers are relevant (earlier tests added deposits).
    const simDeposits = listDeposits(10).filter((d) => d.txid?.startsWith('sim-'));
    expect(simDeposits).toHaveLength(1);
    expect(simDeposits[0]?.amount).toBe(10);
    expect(simDeposits[0]?.tokenContractAddress).toBe(TOKEN_CONTRACT);
  });
});

/* -------------------------------- endpoints -------------------------------- */

describe('Phase 7.4 token endpoints', () => {
  it('GET /api/tron/token-status reports the missing contract clearly', async () => {
    process.env['TRON_MODE'] = 'NILE';
    await loadTokenModules();
    const { default: Fastify } = await import('fastify');
    const { tronRoutes } = await import('../src/routes/tronRoutes.js');
    tokenService.setTokenQuerier(stubQuerier());
    const app = Fastify();
    await app.register(tronRoutes, { prefix: '/api' });

    const res = await app.inject({ method: 'GET', url: '/api/tron/token-status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tokenConfigured: boolean; errors: string[]; warnings: string[] };
    expect(body.tokenConfigured).toBe(false);
    expect(body.errors).toContain('TOKEN_CONTRACT_MISSING');
    await app.close();
  });

  it('PUT /api/tron/token-contract validates, saves (DB overrides env), audits and re-checks', async () => {
    process.env['TRON_MODE'] = 'NILE';
    process.env['TRON_USDT_CONTRACT_ADDRESS'] = OTHER_CONTRACT; // env default
    await loadTokenModules();
    const { default: Fastify } = await import('fastify');
    const { tronRoutes } = await import('../src/routes/tronRoutes.js');
    const { listSettingsAudit } = await import('../src/db/repositories.js');
    tokenService.setTokenQuerier(stubQuerier());
    const app = Fastify();
    await app.register(tronRoutes, { prefix: '/api' });

    // Invalid format → 400 with the machine-readable code.
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/tron/token-contract',
      payload: { address: 'garbage' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'TOKEN_CONTRACT_INVALID' });

    // Valid → saved to the DB (source DATABASE overrides the env default).
    const good = await app.inject({
      method: 'PUT',
      url: '/api/tron/token-contract',
      payload: { address: TOKEN_CONTRACT },
    });
    expect(good.statusCode).toBe(200);
    const status = good.json() as {
      tokenContractAddress: string;
      tokenContractSource: string;
      tokenConnected: boolean;
      tokenSymbol: string;
    };
    expect(status.tokenContractAddress).toBe(TOKEN_CONTRACT);
    expect(status.tokenContractSource).toBe('DATABASE');
    expect(status.tokenConnected).toBe(true);
    expect(status.tokenSymbol).toBe('USDT-TEST');

    const audit = listSettingsAudit(5);
    expect(audit[0]).toMatchObject({ key: 'usdt_token_contract', newValue: TOKEN_CONTRACT });

    // GET reflects the DB override (not the env default).
    const res = await app.inject({ method: 'GET', url: '/api/tron/token-status' });
    expect((res.json() as { tokenContractAddress: string }).tokenContractAddress).toBe(TOKEN_CONTRACT);

    // Manual refresh endpoint.
    const test = await app.inject({ method: 'POST', url: '/api/tron/token-test' });
    expect(test.statusCode).toBe(200);
    expect((test.json() as { tokenConnected: boolean }).tokenConnected).toBe(true);
    await app.close();
  });
});
