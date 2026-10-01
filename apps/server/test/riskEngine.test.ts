import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AiDecision } from '@aioption/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-risk-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let risk: InstanceType<typeof import('../src/risk/riskEngine.js')['RiskEngine']>;
let wallet: InstanceType<typeof import('../src/services/walletService.js')['WalletService']>;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { RiskEngine } = await import('../src/risk/riskEngine.js');
  const { WalletService } = await import('../src/services/walletService.js');
  connection.initDb();
  wallet = new WalletService();
  risk = new RiskEngine(wallet);
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Close any leftover OPEN positions from previous tests.
  for (const p of repo.listPositions('OPEN')) {
    repo.updatePosition(p.id, { status: 'CLOSED', closedAt: new Date().toISOString() });
  }
  repo.updateAccount({
    cashBalance: 0,
    lockedBalance: 0,
    equity: 0,
    tradingEnabled: false,
    startingEquity: 0,
    maxOpenPositions: 5,
    lossLimitPercent: 5,
    fixedTradeSizeUsd: 10,
  });
});

const decision = (overrides: Partial<AiDecision> = {}): AiDecision => ({
  id: 1,
  symbol: 'BTC/USDT',
  signal: 'BULLISH',
  action: 'OPEN_CALL',
  confidence: 0.7,
  expectedReturn: 0.05,
  proposedTradeSizeUsd: 10,
  rationale: 'test',
  executed: false,
  positionId: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('RiskEngine.evaluate', () => {
  it('rejects when trading is disabled', () => {
    expect(risk.evaluate(decision())).toMatchObject({
      approved: false,
      reason: 'trading is disabled',
    });
  });

  it('rejects neutral signals', () => {
    repo.updateAccount({ tradingEnabled: true, equity: 1000, startingEquity: 1000 });
    const verdict = risk.evaluate(decision({ signal: 'NEUTRAL', action: 'HOLD' }));
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/neutral/);
  });

  it('rejects trade sizes that do not match the fixed limit', () => {
    repo.updateAccount({ tradingEnabled: true, equity: 1000, startingEquity: 1000 });
    const verdict = risk.evaluate(decision({ proposedTradeSizeUsd: 999 }));
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/does not match the fixed limit/);
  });

  it('rejects when the cash balance cannot cover the trade', () => {
    repo.updateAccount({
      tradingEnabled: true,
      equity: 1000,
      startingEquity: 1000,
      cashBalance: 5,
    });
    const verdict = risk.evaluate(decision());
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/insufficient cash balance/);
  });

  it('rejects when open positions reached the maximum', () => {
    repo.updateAccount({
      tradingEnabled: true,
      equity: 1000,
      startingEquity: 1000,
      cashBalance: 1000,
      maxOpenPositions: 1,
    });
    repo.createPosition({
      symbol: 'BTC-2026-10-08-67000-C',
      side: 'CALL',
      strikePrice: 67000,
      expiry: '2026-10-08',
      quantity: 0.01,
      entryPremium: 1000,
      openedAt: new Date().toISOString(),
    });
    const verdict = risk.evaluate(decision());
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/reached the limit/);
  });

  it('approves a valid decision when trading is enabled with capacity', () => {
    repo.updateAccount({
      tradingEnabled: true,
      equity: 1000,
      startingEquity: 1000,
      cashBalance: 1000,
    });
    expect(risk.evaluate(decision())).toEqual({ approved: true, reason: null });
  });
});

describe('RiskEngine.checkLossLimit', () => {
  it('does not trigger above the threshold', () => {
    repo.updateAccount({ tradingEnabled: true, equity: 951, startingEquity: 1000, lossLimitPercent: 5 });
    expect(risk.checkLossLimit()).toEqual({ triggered: false });
    expect(repo.getAccount().tradingEnabled).toBe(true);
  });

  it('does not trigger when trading is disabled or starting equity is missing', () => {
    repo.updateAccount({ tradingEnabled: false, equity: 100, startingEquity: 1000, lossLimitPercent: 5 });
    expect(risk.checkLossLimit()).toEqual({ triggered: false });
    repo.updateAccount({ tradingEnabled: true, equity: 100, startingEquity: 0, lossLimitPercent: 5 });
    expect(risk.checkLossLimit()).toEqual({ triggered: false });
  });

  it('triggers exactly at the threshold boundary', () => {
    // equity 950 == threshold 1000 * (1 - 0.05)
    repo.updateAccount({ tradingEnabled: true, equity: 950, startingEquity: 1000, lossLimitPercent: 5 });
    expect(risk.checkLossLimit()).toEqual({ triggered: true });
    expect(repo.getAccount().tradingEnabled).toBe(false);
  });

  it('triggers at the threshold, closes positions, unlocks funds, disables trading, logs a risk event', () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000, lossLimitPercent: 5 });
    wallet.lockFunds(200, 'reserve for trade');
    const created = repo.createPosition({
      symbol: 'BTC-2026-10-08-67000-C',
      side: 'CALL',
      strikePrice: 67000,
      expiry: '2026-10-08',
      quantity: 2,
      entryPremium: 100,
      openedAt: new Date().toISOString(),
    });

    // equity 900 <= threshold 1000 * (1 - 0.05) = 950
    repo.updateAccount({ equity: 900 });

    expect(risk.checkLossLimit()).toEqual({ triggered: true });

    const account = repo.getAccount();
    expect(account.tradingEnabled).toBe(false);
    expect(account.lockedBalance).toBe(0);
    expect(account.cashBalance).toBe(1000); // funds released
    expect(repo.listPositions('OPEN')).toHaveLength(0);
    expect(repo.getPositionById(created.id)?.status).toBe('CLOSED');

    const events = repo.listRiskEvents(); // newest first
    expect(events[0]?.type).toBe('LOSS_LIMIT_DAILY');
    expect(events[0]?.equityAtTrigger).toBe(900);

    // trading stays off: further checks are no-ops
    expect(risk.checkLossLimit()).toEqual({ triggered: false });
  });
});
