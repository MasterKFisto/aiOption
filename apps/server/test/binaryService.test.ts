import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinaryPriceFeed } from '../src/binary/binaryTypes.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-binary-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let BinaryService: typeof import('../src/binary/binaryService.js')['BinaryService'];
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

/** Controllable feed: pushes ticks manually. */
class StubFeed implements BinaryPriceFeed {
  private readonly ticks: PriceTick[] = [];

  push(price: number, timestampIso?: string): void {
    this.ticks.push({
      price,
      timestamp: timestampIso ?? new Date().toISOString(),
      source: 'STUB',
    });
  }

  getLatestTick(): PriceTick | null {
    return this.ticks.at(-1) ?? null;
  }

  getTickAtOrAfter(timestampIso: string): PriceTick | null {
    const target = new Date(timestampIso).getTime();
    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const tick = this.ticks[i]!;
      if (new Date(tick.timestamp).getTime() >= target) {
        return tick;
      }
    }
    return null;
  }
}

let feed: StubFeed;
let service: InstanceType<typeof BinaryService>;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  BinaryService = (await import('../src/binary/binaryService.js')).BinaryService;
  connection.initDb();
  feed = new StubFeed();
  service = new BinaryService(feed);
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  feed = new StubFeed();
  service = new BinaryService(feed);
  feed.push(100); // fresh entry tick
  for (const p of repo.listPositions('OPEN')) {
    repo.updatePosition(p.id, { status: 'CLOSED', closedAt: new Date().toISOString() });
  }
  // Cancel leftover OPEN binary contracts from previous tests.
  connection
    .getDb()
    .prepare("UPDATE binary_contracts SET status = 'CANCELLED', settled_at = ? WHERE status = 'OPEN'")
    .run(new Date().toISOString());
  repo.updateAccount({
    cashBalance: 100,
    lockedBalance: 0,
    equity: 100,
    tradingEnabled: true,
    startingEquity: 100,
    maxOpenPositions: 5,
    lossLimitPercent: 5,
    fixedTradeSizeUsd: 10,
  });
});

const openInput = (overrides: Record<string, unknown> = {}) => ({
  asset: 'BTC/USDC',
  direction: 'UP' as const,
  stakeUsd: 10,
  durationSeconds: 5,
  payoutRatio: 0.8,
  ...overrides,
});

describe('BinaryService quotes and validation', () => {
  it('computes the quote math (stake 10, ratio 0.8 → profit 8, return 18)', () => {
    const quote = service.getQuote(10, 5, 0.8);
    expect(quote.potentialProfit).toBe(8);
    expect(quote.totalReturnIfWin).toBe(18);
    expect(quote.totalLossIfLose).toBe(10);
    expect(quote.currentPrice).toBe(100);
    expect(quote.warnings.length).toBeGreaterThan(0);
  });

  it('rejects invalid inputs', () => {
    expect(() => service.getQuote(10, 5, 0.42)).toThrow(/payout ratio/);
    expect(() => service.openBinaryContract(openInput({ asset: 'ETH/USDC' }))).toThrow(/BTC\/USDC/);
    expect(() => service.openBinaryContract(openInput({ direction: 'SIDEWAYS' }))).toThrow(/UP or DOWN/);
    expect(() => service.openBinaryContract(openInput({ stakeUsd: 0.5 }))).toThrow(/at least/);
    expect(() => service.openBinaryContract(openInput({ stakeUsd: 500 }))).toThrow(/at most/);
    expect(() => service.openBinaryContract(openInput({ durationSeconds: 7 }))).toThrow(/duration/);
  });

  it('blocks opening when trading is disabled', () => {
    repo.updateAccount({ tradingEnabled: false });
    expect(() => service.openBinaryContract(openInput())).toThrow(/trading is disabled/);
  });

  it('blocks opening below the loss floor and logs a risk event', () => {
    repo.updateAccount({ equity: 90, startingEquity: 100, lossLimitPercent: 5 }); // floor 95
    expect(() => service.openBinaryContract(openInput())).toThrow(/loss limit/);
    expect(repo.listRiskEvents()[0]?.type).toBe('BINARY_LOSS_LIMIT_BLOCK');
  });

  it('blocks opening with insufficient balance', () => {
    repo.updateAccount({ cashBalance: 5 });
    expect(() => service.openBinaryContract(openInput({ stakeUsd: 10 }))).toThrow(/insufficient balance/);
  });

  it('has NO cap on the number of open contracts by default (BINARY_MAX_OPEN_CONTRACTS=0)', () => {
    for (let i = 0; i < 12; i++) {
      feed.push(100 + i);
      service.openBinaryContract(openInput({ stakeUsd: 1 }));
    }
    expect(repo.listRiskEvents().some((e) => e.type === 'BINARY_MAX_OPEN_CONTRACTS_REACHED')).toBe(false);
  });

  it('still enforces an explicitly configured cap and logs a risk event', async () => {
    const { config } = await import('../src/config.js');
    const mutable = config as { BINARY_MAX_OPEN_CONTRACTS: number };
    const original = mutable.BINARY_MAX_OPEN_CONTRACTS;
    mutable.BINARY_MAX_OPEN_CONTRACTS = 3;
    try {
      for (let i = 0; i < 3; i++) {
        feed.push(100 + i);
        service.openBinaryContract(openInput({ stakeUsd: 1 }));
      }
      expect(() => service.openBinaryContract(openInput({ stakeUsd: 1 }))).toThrow(/maximum of 3/);
      expect(repo.listRiskEvents()[0]?.type).toBe('BINARY_MAX_OPEN_CONTRACTS_REACHED');
    } finally {
      mutable.BINARY_MAX_OPEN_CONTRACTS = original;
    }
  });

  it('blocks opening when the market feed is stale', () => {
    const staleFeed = new StubFeed();
    staleFeed.push(100, new Date(Date.now() - 60_000).toISOString());
    const staleService = new BinaryService(staleFeed);
    expect(() => staleService.openBinaryContract(openInput())).toThrow(/stale/);
    expect(repo.listRiskEvents()[0]?.type).toBe('BINARY_MARKET_DATA_STALE');
  });
});

describe('BinaryService open + settlement', () => {
  it('opens a contract, locks the stake, and records BINARY_STAKE_LOCKED', () => {
    const contract = service.openBinaryContract(openInput());
    expect(contract.status).toBe('OPEN');
    expect(contract.entryPrice).toBe(100);
    expect(contract.potentialProfitUsd).toBe(8);
    expect(contract.totalReturnIfWinUsd).toBe(18);

    const account = repo.getAccount();
    expect(account.cashBalance).toBe(90);
    expect(account.lockedBalance).toBe(10);
    expect(repo.listTransactions()[0]?.type).toBe('BINARY_STAKE_LOCKED');
  });

  it('settles a WIN: credits stake + profit, updates equity and ledger', () => {
    const contract = service.openBinaryContract(openInput({ direction: 'UP' }));
    const settleAt = new Date(new Date(contract.expiresAt).getTime() + 100).toISOString();
    feed.push(105, new Date(new Date(contract.expiresAt).getTime() + 50).toISOString());

    expect(service.settleDueContracts(settleAt)).toBe(1);

    const history = service.getHistory(5);
    expect(history[0]?.result).toBe('WIN');
    expect(history[0]?.settlementPrice).toBe(105);

    const account = repo.getAccount();
    expect(account.cashBalance).toBe(108); // 90 + 18
    expect(account.lockedBalance).toBe(0);
    expect(account.equity).toBe(108); // 100 + 8
    expect(repo.listTransactions()[0]?.type).toBe('BINARY_WIN');
  });

  it('settles a LOSE: stake is lost, equity drops', () => {
    const contract = service.openBinaryContract(openInput({ direction: 'DOWN' }));
    const settleAt = new Date(new Date(contract.expiresAt).getTime() + 100).toISOString();
    feed.push(105, new Date(new Date(contract.expiresAt).getTime() + 50).toISOString());

    service.settleDueContracts(settleAt);

    expect(service.getHistory(5)[0]?.result).toBe('LOSE');
    const account = repo.getAccount();
    expect(account.cashBalance).toBe(90);
    expect(account.lockedBalance).toBe(0);
    expect(account.equity).toBe(90);
    expect(repo.listTransactions()[0]?.type).toBe('BINARY_LOSS');
  });

  it('refunds when the settlement price equals the entry price', () => {
    const contract = service.openBinaryContract(openInput({ direction: 'UP' }));
    const settleAt = new Date(new Date(contract.expiresAt).getTime() + 100).toISOString();
    feed.push(100, new Date(new Date(contract.expiresAt).getTime() + 50).toISOString());

    service.settleDueContracts(settleAt);

    expect(service.getHistory(5)[0]?.result).toBe('REFUND');
    const account = repo.getAccount();
    expect(account.cashBalance).toBe(100); // stake returned
    expect(account.lockedBalance).toBe(0);
    expect(account.equity).toBe(100); // unchanged
    expect(repo.listTransactions()[0]?.type).toBe('BINARY_REFUND');
  });

  it('never double-settles (atomic status update)', () => {
    const contract = service.openBinaryContract(openInput());
    const settleAt = new Date(new Date(contract.expiresAt).getTime() + 100).toISOString();
    feed.push(110, new Date(new Date(contract.expiresAt).getTime() + 50).toISOString());

    expect(service.settleDueContracts(settleAt)).toBe(1);
    expect(service.settleDueContracts(settleAt)).toBe(0);
    expect(repo.getAccount().cashBalance).toBe(108);
  });

  it('errors + refunds when no price arrives within the stale window', async () => {
    const { config } = await import('../src/config.js');
    const contract = service.openBinaryContract(openInput());
    // Wait just past the configured stale window (8 s by default since 6.5.2).
    const settleAt = new Date(
      new Date(contract.expiresAt).getTime() + config.BINARY_MAX_PRICE_STALE_MS + 2000,
    ).toISOString();

    expect(service.settleDueContracts(settleAt)).toBe(1);

    const history = service.getHistory(5);
    expect(history[0]?.status).toBe('ERROR');
    expect(history[0]?.rejectionReason).toMatch(/no market price/);
    const account = repo.getAccount();
    expect(account.cashBalance).toBe(100); // stake refunded
    expect(account.lockedBalance).toBe(0);
    expect(repo.listRiskEvents()[0]?.type).toBe('BINARY_MARKET_DATA_STALE');
  });

  it('summary aggregates counts, net PnL and open contracts', () => {
    const summary = service.getSummary();
    expect(summary.openCount).toBe(0);
    expect(summary.netPnlUsd).toBeGreaterThanOrEqual(0);
  });
});


