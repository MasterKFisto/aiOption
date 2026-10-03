import { afterEach, describe, expect, it, vi } from 'vitest';

describe('config', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env['TRADING_MODE'];
    delete process.env['CORS_ORIGIN'];
    delete process.env['DB_PATH'];
    delete process.env['BINARY_ALLOWED_DURATIONS_SECONDS'];
    delete process.env['BINARY_ALLOWED_PAYOUT_RATIOS'];
    delete process.env['BINARY_ENABLED'];
    delete process.env['AI_BINARY_DURATION_SECONDS'];
    delete process.env['AI_BINARY_PAYOUT_RATIO'];
  });

  it('uses safe defaults when the environment is empty', async () => {
    vi.resetModules();
    const { config } = await import('../src/config.js');
    expect(config.MODE).toBe('PAPER');
    expect(config.BASE_CURRENCY).toBe('USDC');
    expect(config.FIXED_TRADE_SIZE_USD).toBe(10);
    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('parses a comma-separated CORS_ORIGIN list with whitespace', async () => {
    vi.resetModules();
    process.env['CORS_ORIGIN'] = ' http://a.example , http://b.example ';
    const { config } = await import('../src/config.js');
    expect(config.CORS_ORIGINS).toEqual(['http://a.example', 'http://b.example']);
  });

  it('supports the wildcard CORS origin', async () => {
    vi.resetModules();
    process.env['CORS_ORIGIN'] = '*';
    const { config } = await import('../src/config.js');
    expect(config.CORS_ORIGINS).toEqual(['*']);
  });

  it('fails fast on an invalid TRADING_MODE', async () => {
    vi.resetModules();
    process.env['TRADING_MODE'] = 'BOGUS';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    await expect(import('../src/config.js')).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('coerces numeric values from strings', async () => {
    vi.resetModules();
    process.env['FIXED_TRADE_SIZE_USD'] = '25';
    process.env['MAX_OPEN_POSITIONS'] = '7';
    const { config } = await import('../src/config.js');
    expect(config.FIXED_TRADE_SIZE_USD).toBe(25);
    expect(config.MAX_OPEN_POSITIONS).toBe(7);
  });

  it('parses binary option settings', async () => {
    vi.resetModules();
    process.env['BINARY_ALLOWED_DURATIONS_SECONDS'] = '5,10,15';
    process.env['BINARY_ALLOWED_PAYOUT_RATIOS'] = '0.5,0.9';
    process.env['BINARY_ENABLED'] = 'false';
    process.env['AI_BINARY_PAYOUT_RATIO'] = '0.5';
    const { config } = await import('../src/config.js');
    expect(config.BINARY_ALLOWED_DURATIONS_SECONDS).toEqual([5, 10, 15]);
    expect(config.BINARY_ALLOWED_PAYOUT_RATIOS).toEqual([0.5, 0.9]);
    expect(config.BINARY_ENABLED).toBe(false);
    expect(config.BINARY_LIVE_TRADING_ENABLED).toBe(false);
    // Phase 6.5.2: no cap on the number of trades by default (0 = unlimited).
    expect(config.BINARY_MAX_OPEN_CONTRACTS).toBe(0);
    expect(config.AI_BINARY_MAX_OPEN_CONTRACTS).toBe(0);
    expect(config.AI_BINARY_MAX_TRADES_PER_HOUR).toBe(0);
    expect(config.MAX_OPEN_POSITIONS).toBeGreaterThanOrEqual(0);
  });

  it('raises stale-price thresholds that are too tight for the poll interval (Phase 6.5.2 fix)', async () => {
    vi.resetModules();
    process.env['MARKET_POLL_INTERVAL_MS'] = '3000';
    process.env['OPTION_MAX_PRICE_STALE_MS'] = '3000';
    try {
      const { config } = await import('../src/config.js');
      // 2 × poll + 2 s latency margin — a normal poll delay never looks stale.
      expect(config.OPTION_MAX_PRICE_STALE_MS).toBe(8000);
      expect(config.BINARY_MAX_PRICE_STALE_MS).toBeGreaterThanOrEqual(8000);
    } finally {
      delete process.env['MARKET_POLL_INTERVAL_MS'];
      delete process.env['OPTION_MAX_PRICE_STALE_MS'];
    }
  });

  it('fails fast when the AI duration is not an allowed binary duration', async () => {
    vi.resetModules();
    process.env['AI_BINARY_DURATION_SECONDS'] = '7';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    await expect(import('../src/config.js')).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails fast when the AI payout ratio is not an allowed binary ratio', async () => {
    vi.resetModules();
    process.env['AI_BINARY_PAYOUT_RATIO'] = '0.33';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    await expect(import('../src/config.js')).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts AI duration/ratio that match the allowed sets', async () => {
    vi.resetModules();
    process.env['AI_BINARY_DURATION_SECONDS'] = '5';
    process.env['AI_BINARY_PAYOUT_RATIO'] = '0.9';
    const { config } = await import('../src/config.js');
    expect(config.AI_BINARY_DURATION_SECONDS).toBe(5);
    expect(config.AI_BINARY_PAYOUT_RATIO).toBe(0.9);
  });
});
