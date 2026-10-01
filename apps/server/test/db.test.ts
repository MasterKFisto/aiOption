import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-db-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  connection.initDb();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('connection + migrations', () => {
  it('opens the DB at the configured path with WAL mode and foreign keys on', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    const db = connection.getDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('creates all five tables', () => {
    const rows = connection
      .getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as ReadonlyArray<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['account', 'positions', 'transactions', 'ai_decisions', 'risk_events']),
    );
  });

  it('initDb is idempotent', () => {
    expect(connection.initDb()).toBe(connection.getDb());
  });
});

describe('account repository', () => {
  it('seeds a single account row with sensible defaults', () => {
    const account = repo.getAccount();
    expect(account.id).toBe(1);
    expect(account.mode).toBe('PAPER');
    expect(account.cashBalance).toBe(0);
    expect(account.lockedBalance).toBe(0);
    expect(account.equity).toBe(0);
    expect(account.baseCurrency).toBe('USDC');
    expect(account.fixedTradeSizeUsd).toBe(10);
    expect(account.maxOpenPositions).toBe(5);
    expect(account.lossLimitPercent).toBe(5);
    expect(account.tradingEnabled).toBe(false);
    expect(account.startingEquity).toBe(0);
  });

  it('updateAccount patches only the provided fields', () => {
    const updated = repo.updateAccount({ equity: 500, cashBalance: 400, lockedBalance: 100 });
    expect(updated.equity).toBe(500);
    expect(updated.cashBalance).toBe(400);
    expect(updated.lockedBalance).toBe(100);
    expect(updated.fixedTradeSizeUsd).toBe(10); // untouched
    expect(updated.lossLimitPercent).toBe(5); // untouched

    const again = repo.updateAccount({ lockedBalance: 0 });
    expect(again.equity).toBe(500); // untouched
    expect(again.lockedBalance).toBe(0);
  });
});

describe('positions repository', () => {
  it('creates, reads, lists, and closes positions', () => {
    const created = repo.createPosition({
      symbol: 'BTC',
      side: 'CALL',
      strikePrice: 67000,
      expiry: '2026-10-30',
      quantity: 0.5,
      entryPremium: 1200,
      openedAt: new Date().toISOString(),
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe('OPEN');
    expect(created.exitPremium).toBeNull();
    expect(created.realizedPnl).toBeNull();
    expect(repo.getPositionById(created.id)?.id).toBe(created.id);
    expect(repo.listPositions('OPEN')).toHaveLength(1);
    expect(repo.listPositions('CLOSED')).toHaveLength(0);

    const closed = repo.updatePosition(created.id, {
      status: 'CLOSED',
      exitPremium: 1800,
      realizedPnl: 300,
      closedAt: new Date().toISOString(),
    });
    expect(closed?.status).toBe('CLOSED');
    expect(closed?.exitPremium).toBe(1800);
    expect(closed?.realizedPnl).toBe(300);
    expect(closed?.closedAt).not.toBeNull();
    expect(repo.listPositions('OPEN')).toHaveLength(0);
    expect(repo.listPositions('CLOSED')).toHaveLength(1);
  });

  it('returns null for unknown positions', () => {
    expect(repo.getPositionById(9999)).toBeNull();
    expect(repo.updatePosition(9999, { status: 'CLOSED' })).toBeNull();
  });
});

describe('transactions repository', () => {
  it('logs and lists transactions', () => {
    const tx = repo.logTransaction({
      type: 'DEPOSIT',
      amount: 100,
      currency: 'USDC',
      description: 'test',
      positionId: null,
    });
    expect(tx.id).toBeGreaterThan(0);
    expect(tx.amount).toBe(100);
    const list = repo.listTransactions();
    expect(list[0]?.id).toBe(tx.id);
    expect(list[0]?.type).toBe('DEPOSIT');
  });
});

describe('ai decisions repository', () => {
  it('logs decisions with signal, expected return, and trade size', () => {
    const decision = repo.logAiDecision({
      symbol: 'BTC/USDT',
      signal: 'BULLISH',
      action: 'OPEN_CALL',
      confidence: 0.8,
      expectedReturn: 0.04,
      proposedTradeSizeUsd: 10,
      rationale: 'test',
      executed: false,
      positionId: null,
    });
    expect(decision.signal).toBe('BULLISH');
    expect(decision.expectedReturn).toBe(0.04);
    expect(decision.proposedTradeSizeUsd).toBe(10);
    expect(decision.executed).toBe(false);
    const list = repo.listAiDecisions();
    expect(list[0]?.id).toBe(decision.id);
  });

  it('gets decisions by id and marks them executed with a position link', () => {
    const created = repo.logAiDecision({
      symbol: 'ETH/USDT',
      signal: 'BEARISH',
      action: 'OPEN_PUT',
      confidence: 0.6,
      expectedReturn: -0.02,
      proposedTradeSizeUsd: 10,
      rationale: 'test',
      executed: false,
      positionId: null,
    });
    expect(repo.getAiDecisionById(created.id)?.id).toBe(created.id);
    expect(repo.getAiDecisionById(99999)).toBeNull();

    const position = repo.createPosition({
      symbol: 'ETH-2026-10-08-2600-P',
      side: 'PUT',
      strikePrice: 2600,
      expiry: '2026-10-08',
      quantity: 0.1,
      entryPremium: 78,
      openedAt: new Date().toISOString(),
    });
    const marked = repo.markAiDecisionExecuted(created.id, position.id);
    expect(marked?.executed).toBe(true);
    expect(marked?.positionId).toBe(position.id);
    expect(repo.getAiDecisionById(created.id)?.executed).toBe(true);
    expect(repo.markAiDecisionExecuted(99999, null)).toBeNull();
  });
});

describe('risk events repository', () => {
  it('logs risk events', () => {
    const event = repo.logRiskEvent({
      type: 'LOSS_LIMIT_DAILY',
      message: 'test',
      equityAtTrigger: 950,
    });
    expect(event.id).toBeGreaterThan(0);
    expect(repo.listRiskEvents()[0]?.id).toBe(event.id);
  });
});
