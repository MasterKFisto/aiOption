import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 7: network + safety config guards.
 * - MODE alias (PRODUCTION → LIVE, conflict detection)
 * - TESTNET requires a test network (SHASTA/NILE)
 * - LIVE requires LIVE_MODE_CONFIRM; live broadcasts need the second confirm
 * - TRON_RPC_URL / TRON_EXPLORER_URL https-only; no mainnet RPC in test modes
 */
const PHASE7_VARS = [
  'MODE',
  'TRADING_MODE',
  'TRON_MODE',
  'TRON_NETWORK_NAME',
  'TRON_RPC_URL',
  'TRON_EXPLORER_URL',
  'LIVE_MODE_CONFIRM',
  'LIVE_WITHDRAWALS_CONFIRM',
  'ENABLE_LIVE_TRON_WITHDRAWALS',
  'TRON_HOT_WALLET_PRIVATE_KEY',
  'ENABLE_ADMIN_API',
] as const;

function clearEnv(): void {
  for (const name of PHASE7_VARS) {
    delete process.env[name];
  }
}

async function importConfig() {
  vi.resetModules();
  return (await import('../src/config.js')).config;
}

async function expectConfigFailure(): Promise<void> {
  vi.resetModules();
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
  await expect(import('../src/config.js')).rejects.toThrow('process.exit called');
  expect(exitSpy).toHaveBeenCalledWith(1);
}

describe('Phase 7 config guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    clearEnv();
  });

  it('accepts TESTNET with SHASTA and exposes the network/testnet metadata', async () => {
    clearEnv();
    process.env['MODE'] = 'TESTNET';
    process.env['TRON_MODE'] = 'SHASTA';
    process.env['TRON_NETWORK_NAME'] = 'Shasta Testnet';
    process.env['TRON_RPC_URL'] = 'https://api.shasta.trongrid.io';
    process.env['TRON_EXPLORER_URL'] = 'https://shasta.tronscan.org';
    const config = await importConfig();
    expect(config.MODE).toBe('TESTNET');
    expect(config.TRON_MODE).toBe('SHASTA');
    expect(config.TRON_NETWORK_NAME).toBe('Shasta Testnet');
    expect(config.SIMULATION_ALLOWED).toBe(true);
    expect(config.ENABLE_ADMIN_API).toBe(false);
    expect(config.ENABLE_LIVE_TRON_WITHDRAWALS).toBe(false);
  });

  it('accepts TESTNET with NILE', async () => {
    clearEnv();
    process.env['MODE'] = 'TESTNET';
    process.env['TRON_MODE'] = 'NILE';
    const config = await importConfig();
    expect(config.MODE).toBe('TESTNET');
    expect(config.TRON_MODE).toBe('NILE');
  });

  it('refuses TESTNET with TRON_MODE=MAINNET (mainnet is never a testnet)', async () => {
    clearEnv();
    process.env['MODE'] = 'TESTNET';
    process.env['TRON_MODE'] = 'MAINNET';
    await expectConfigFailure();
  });

  it('refuses TESTNET with the default SIMULATED Tron mode', async () => {
    clearEnv();
    process.env['MODE'] = 'TESTNET';
    await expectConfigFailure();
  });

  it('maps MODE=PRODUCTION to LIVE and requires the live confirmation', async () => {
    clearEnv();
    process.env['MODE'] = 'PRODUCTION';
    process.env['TRON_MODE'] = 'MAINNET';
    await expectConfigFailure(); // missing LIVE_MODE_CONFIRM
    process.env['LIVE_MODE_CONFIRM'] = 'I_UNDERSTAND_REAL_FUNDS';
    const config = await importConfig();
    expect(config.MODE).toBe('LIVE');
    expect(config.SIMULATION_ALLOWED).toBe(false);
  });

  it('rejects a MODE/TRADING_MODE conflict', async () => {
    clearEnv();
    process.env['TRADING_MODE'] = 'PAPER';
    process.env['MODE'] = 'LIVE';
    await expectConfigFailure();
  });

  it('lets an explicit TRADING_MODE win over an unknown MODE value', async () => {
    clearEnv();
    process.env['TRADING_MODE'] = 'PAPER';
    process.env['MODE'] = 'test'; // Vitest sets this — must be ignored
    const config = await importConfig();
    expect(config.MODE).toBe('PAPER');
  });

  it('refuses LIVE without LIVE_MODE_CONFIRM', async () => {
    clearEnv();
    process.env['TRADING_MODE'] = 'LIVE';
    await expectConfigFailure();
  });

  it('requires the withdrawals confirmation for live broadcasts in LIVE mode', async () => {
    clearEnv();
    process.env['TRADING_MODE'] = 'LIVE';
    process.env['LIVE_MODE_CONFIRM'] = 'I_UNDERSTAND_REAL_FUNDS';
    process.env['ENABLE_LIVE_TRON_WITHDRAWALS'] = 'true';
    process.env['TRON_HOT_WALLET_PRIVATE_KEY'] = 'a'.repeat(64);
    await expectConfigFailure(); // missing LIVE_WITHDRAWALS_CONFIRM
    process.env['LIVE_WITHDRAWALS_CONFIRM'] = 'I_UNDERSTAND_LIVE_WITHDRAWALS';
    const config = await importConfig();
    expect(config.ENABLE_LIVE_TRON_WITHDRAWALS).toBe(true);
  });

  it('never enables live withdrawals without a private key, flag or not', async () => {
    clearEnv();
    process.env['MODE'] = 'TESTNET';
    process.env['TRON_MODE'] = 'SHASTA';
    process.env['ENABLE_LIVE_TRON_WITHDRAWALS'] = 'true';
    const config = await importConfig();
    expect(config.ENABLE_LIVE_TRON_WITHDRAWALS).toBe(false);
  });

  it('rejects non-https RPC and explorer URLs', async () => {
    clearEnv();
    process.env['TRON_RPC_URL'] = 'http://api.shasta.trongrid.io';
    await expectConfigFailure();
    clearEnv();
    process.env['TRON_EXPLORER_URL'] = 'not-a-url';
    await expectConfigFailure();
  });

  it('rejects a mainnet TronGrid RPC URL when TRON_MODE is a testnet', async () => {
    clearEnv();
    process.env['MODE'] = 'TESTNET';
    process.env['TRON_MODE'] = 'SHASTA';
    process.env['TRON_RPC_URL'] = 'https://api.trongrid.io';
    await expectConfigFailure();
  });
});
