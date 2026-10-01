import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Candle, Ticker, VolatilityEstimate } from '@aioption/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradingLoop } from '../src/scheduler/tradingLoop.js';
import type { MarketDataProvider } from '../src/strategy/signalEngine.js';

let TradingLoopCtor: typeof TradingLoop;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-loop-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let wallet: InstanceType<typeof import('../src/services/walletService.js')['WalletService']>;

const HOUR = 3_600_000;

/** Rising closes → BULLISH; adjustable volatility. */
function stubMarket(annualizedVolPercent: number): MarketDataProvider {
  const closes = Array.from({ length: 25 }, (_, i) => 66000 + i * 40); // +1.6%
  const candles: Candle[] = closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      timestamp: Date.now() - (closes.length - 1 - i) * HOUR,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 100,
    };
  });
  return {
    getSymbols: () => ['BTC/USDT'],
    getCandles: (_symbol: string, count?: number) => candles.slice(-(count ?? candles.length)),
    getTicker: (symbol: string): Ticker => ({
      symbol,
      lastPrice: 67000,
      bid: 66966,
      ask: 67034,
      priceChange24h: 1000,
      priceChangePercent24h: 1.5,
      high24h: 67100,
      low24h: 65900,
      volume24h: 5000,
      timestamp: Date.now(),
    }),
    estimateVolatility: (symbol: string, lookbackCandles = 24): VolatilityEstimate => ({
      symbol,
      lookbackCandles,
      perCandlePercent: 0.5,
      annualizedPercent: annualizedVolPercent,
    }),
  };
}

function makeLoop(volPercent: number): TradingLoop {
  return new TradingLoopCtor({ market: stubMarket(volPercent), wallet, intervalMs: 60_000 });
}

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  TradingLoopCtor = (await import('../src/scheduler/tradingLoop.js')).TradingLoop;
  const { WalletService } = await import('../src/services/walletService.js');
  connection.initDb();
  wallet = new WalletService();
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

describe('TradingLoop', () => {
  it('does nothing while trading is disabled in the DB', async () => {
    const loop = makeLoop(50);
    const decisionsBefore = repo.listAiDecisions().length;
    const result = await loop.runOnce();
    expect(result.executed).toHaveLength(0);
    expect(repo.listAiDecisions().length).toBe(decisionsBefore); // no signals generated either
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('executes an approved trade: signal → risk → adapter → wallet + position + decision link', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });

    const loop = makeLoop(50);
    const result = await loop.runOnce();

    expect(result.executed).toHaveLength(1);
    const execution = result.executed[0]!;
    expect(execution.symbol).toBe('BTC/USDT');
    expect(execution.order.status).toBe('FILLED');

    // instrument symbol matches the ATM mapping: BTC-YYYY-MM-DD-{strike}-C
    const position = repo.getPositionById(execution.positionId);
    expect(position?.status).toBe('OPEN');
    expect(position?.symbol).toMatch(/^BTC-\d{4}-\d{2}-\d{2}-\d+-C$/);
    expect(position?.entryPremium).toBe(execution.order.averagePrice);

    // decision is marked executed and linked
    const executedDecision = repo.getAiDecisionById(execution.decisionId);
    expect(executedDecision?.executed).toBe(true);
    expect(executedDecision?.positionId).toBe(position?.id);

    // wallet: funds locked for the ~$10 position (incl. fee)
    const account = repo.getAccount();
    expect(account.lockedBalance).toBeGreaterThan(9.9);
    expect(account.lockedBalance).toBeLessThan(10.3);
    expect(account.cashBalance).toBeCloseTo(1000 - account.lockedBalance, 6);

    // a lock transaction was recorded
    const txs = repo.listTransactions();
    expect(txs[0]?.type).toBe('ADJUSTMENT');
    expect(txs[0]?.amount).toBeCloseTo(-account.lockedBalance, 6);
  });

  it('skips when the open position limit is reached', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000, maxOpenPositions: 1 });

    const loop = makeLoop(50);
    const first = await loop.runOnce();
    expect(first.executed).toHaveLength(1);

    const second = await loop.runOnce();
    expect(second.executed).toHaveLength(0);
    expect(second.skipped.some((s) => /reached the limit/.test(s.reason))).toBe(true);
    expect(repo.listPositions('OPEN')).toHaveLength(1);
  });

  it('skips neutral signals (high volatility)', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000 });

    const loop = makeLoop(500); // vol above threshold → NEUTRAL
    const result = await loop.runOnce();
    expect(result.executed).toHaveLength(0);
    expect(result.skipped.some((s) => /neutral/.test(s.reason))).toBe(true);
    expect(repo.listPositions('OPEN')).toHaveLength(0);
  });

  it('halts and disables trading when the loss limit is breached', async () => {
    wallet.deposit(1000, 'seed');
    repo.updateAccount({ tradingEnabled: true, startingEquity: 1000, lossLimitPercent: 5 });
    const loop = makeLoop(50);
    await loop.runOnce(); // open one position

    repo.updateAccount({ equity: 900 }); // 900 <= 950 threshold
    const result = await loop.runOnce();

    expect(result.halted).toBe(true);
    expect(loop.isRunning).toBe(false);
    expect(repo.getAccount().tradingEnabled).toBe(false);
    expect(repo.listPositions('OPEN')).toHaveLength(0);
    expect(repo.listPositions('CLOSED').length).toBeGreaterThan(0);
    expect(repo.listRiskEvents().length).toBe(1);
  });

  it('start and stop toggle the scheduler', () => {
    const loop = makeLoop(50);
    expect(loop.isRunning).toBe(false);
    loop.start();
    expect(loop.isRunning).toBe(true);
    loop.start(); // idempotent
    expect(loop.isRunning).toBe(true);
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });
});
