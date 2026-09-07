import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the risk engine
const mockPrisma = {
  position: { count: vi.fn() },
  ledgerEntry: { findMany: vi.fn() },
};

vi.mock('../src/config/database.js', () => ({
  getPrisma: () => mockPrisma,
}));

vi.mock('../src/modules/trading/service.js', () => ({
  tradingSettingsService: {
    getSettings: vi.fn(),
  },
}));

vi.mock('../src/modules/wallets/service.js', () => ({
  walletService: {
    getWallet: vi.fn(),
  },
}));

vi.mock('../src/modules/ledger/service.js', () => ({
  ledgerService: {
    getAvailableBalance: vi.fn(),
  },
}));

vi.mock('../src/config/index.js', () => ({
  config: {
    trading: { paperTrading: true, liveTradingEnabled: false },
  },
}));

import { RiskEngine } from '../src/modules/risk/engine.js';
import { tradingSettingsService } from '../src/modules/trading/service.js';
import { walletService } from '../src/modules/wallets/service.js';
import { ledgerService } from '../src/modules/ledger/service.js';
import type { AiSignalInput } from '../src/modules/ai/engine.js';

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    autoTradingEnabled: true,
    maxTradeSizeUsd: { toString: () => '10' },
    dailyLossLimitUsd: { toString: () => '20' },
    weeklyLossLimitUsd: { toString: () => '50' },
    maxOpenPositions: 3,
    allowedAssets: ['USDC', 'ETH', 'BTC'],
    allowedOptionTypes: ['CALL', 'PUT'],
    minAiConfidence: { toNumber: () => 0.6 },
    ...overrides,
  };
}

function makeSignal(overrides: Partial<AiSignalInput> = {}): AiSignalInput {
  return {
    asset: 'ETH',
    direction: 'BULLISH',
    confidence: 0.72,
    expectedReturn: 0.15,
    riskScore: 0.35,
    strategy: 'long_call',
    optionType: 'CALL',
    expiryDays: 7,
    strikeType: 'ATM',
    maxPremiumUsd: '10',
    reason: ['momentum'],
    ...overrides,
  };
}

describe('RiskEngine', () => {
  let risk: RiskEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    risk = new RiskEngine();
  });

  it('rejects when auto trading is disabled', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(
      makeSettings({ autoTradingEnabled: false }) as never,
    );
    const results = await risk.validateSignal('u1', makeSignal());
    expect(results[0]).toMatchObject({ checkName: 'AUTO_TRADING_ENABLED', passed: false });
    expect(results.length).toBe(1); // short-circuits
  });

  it('rejects disallowed assets', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(
      makeSettings({ allowedAssets: ['USDC'] }) as never,
    );
    const results = await risk.validateSignal('u1', makeSignal({ asset: 'ETH' }));
    expect(results).toContainEqual({ checkName: 'ASSET_ALLOWED', passed: false, reason: expect.any(String) });
  });

  it('rejects when AI confidence is below threshold', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(
      makeSettings({ minAiConfidence: { toNumber: () => 0.8 } }) as never,
    );
    const results = await risk.validateSignal('u1', makeSignal({ confidence: 0.5 }));
    expect(results).toContainEqual({ checkName: 'AI_CONFIDENCE', passed: false, reason: expect.any(String) });
  });

  it('rejects when premium exceeds max trade size', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(
      makeSettings({ maxTradeSizeUsd: { toString: () => '5' } }) as never,
    );
    const results = await risk.validateSignal('u1', makeSignal({ maxPremiumUsd: '10' }));
    expect(results).toContainEqual({ checkName: 'MAX_TRADE_SIZE', passed: false, reason: expect.any(String) });
  });

  it('rejects when balance is insufficient', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(makeSettings() as never);
    vi.mocked(walletService.getWallet).mockResolvedValue({ id: 'w1' } as never);
    vi.mocked(ledgerService.getAvailableBalance).mockResolvedValue('1.000000');
    const results = await risk.validateSignal('u1', makeSignal({ maxPremiumUsd: '10' }));
    expect(results).toContainEqual({ checkName: 'AVAILABLE_BALANCE', passed: false, reason: expect.any(String) });
  });

  it('rejects when max open positions is reached', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(
      makeSettings({ maxOpenPositions: 3 }) as never,
    );
    vi.mocked(walletService.getWallet).mockResolvedValue({ id: 'w1' } as never);
    vi.mocked(ledgerService.getAvailableBalance).mockResolvedValue('1000.000000');
    vi.mocked(ledgerService.getAvailableBalance).mockResolvedValue('1000.000000');
    mockPrisma.position.count.mockResolvedValue(3);
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([]);
    const results = await risk.validateSignal('u1', makeSignal());
    expect(results).toContainEqual({ checkName: 'MAX_OPEN_POSITIONS', passed: false, reason: expect.any(String) });
  });

  it('passes all checks for a healthy proposal', async () => {
    vi.mocked(tradingSettingsService.getSettings).mockResolvedValue(makeSettings() as never);
    vi.mocked(walletService.getWallet).mockResolvedValue({ id: 'w1' } as never);
    vi.mocked(ledgerService.getAvailableBalance).mockResolvedValue('1000.000000');
    mockPrisma.position.count.mockResolvedValue(0);
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([]);
    const results = await risk.validateSignal('u1', makeSignal());
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results.map((r) => r.checkName)).toContain('LIVE_TRADING_ENABLED');
  });

  it('allChecksPassed returns false when any check fails', async () => {
    const result = await risk.allChecksPassed([
      { checkName: 'A', passed: true, reason: 'ok' },
      { checkName: 'B', passed: false, reason: 'nope' },
    ]);
    expect(result).toBe(false);
  });
});