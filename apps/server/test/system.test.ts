import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ApiEvent, PriceTick } from '@aioption/shared';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-system-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let tradingLoop: typeof import('../src/scheduler/tradingLoop.js')['tradingLoop'];
let binaryService: InstanceType<typeof import('../src/binary/binaryService.js')['BinaryService']>;
let aiService: InstanceType<typeof import('../src/binary-ai/binaryAiService.js')['AiBinaryService']>;
let feed: {
  push: (price: number, timestampIso?: string) => void;
  reset: () => void;
};

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  process.env['AI_BINARY_ENABLED'] = 'true';
  process.env['AI_BINARY_REQUIRE_SIGNAL_PERSISTENCE_TICKS'] = '1';
  process.env['AI_BINARY_MIN_TIME_BETWEEN_TRADES_MS'] = '0';
  process.env['AI_BINARY_COOLDOWN_AFTER_LOSS_MS'] = '0';
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  tradingLoop = (await import('../src/scheduler/tradingLoop.js')).tradingLoop;

  // Controllable binary price feed.
  const ticks: PriceTick[] = [];
  feed = {
    push: (price: number, timestampIso?: string) =>
      ticks.push({ price, timestamp: timestampIso ?? new Date().toISOString(), source: 'STUB' }),
    reset: () => {
      ticks.length = 0;
    },
  };
  const stubFeed = {
    getLatestTick: () => ticks.at(-1) ?? null,
    getRecentTicks: (limit: number) => ticks.slice(-limit),
    getTickAtOrAfter: (iso: string) => {
      const target = new Date(iso).getTime();
      for (let i = ticks.length - 1; i >= 0; i--) {
        const tick = ticks[i]!;
        if (new Date(tick.timestamp).getTime() >= target) {
          return tick;
        }
      }
      return null;
    },
  };

  const { BinaryService } = await import('../src/binary/binaryService.js');
  binaryService = new BinaryService(stubFeed);

  connection.initDb();

  const { AiBinaryService } = await import('../src/binary-ai/binaryAiService.js');
  aiService = new AiBinaryService(stubFeed, binaryService);

  const { walletRoutes } = await import('../src/routes/walletRoutes.js');
  const { tradingRoutes } = await import('../src/routes/tradingRoutes.js');
  const { dashboardRoutes } = await import('../src/routes/dashboardRoutes.js');
  const { depositRoutes } = await import('../src/routes/depositRoutes.js');
  const { withdrawalRoutes } = await import('../src/routes/withdrawalRoutes.js');
  const { binaryRoutes } = await import('../src/binary/binaryRoutes.js');
  const { binaryAiRoutes } = await import('../src/binary-ai/binaryAiRoutes.js');

  app = Fastify();
  await app.register(walletRoutes, { prefix: '/api/paper' });
  await app.register(tradingRoutes, { prefix: '/api/trading' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(depositRoutes, { prefix: '/api' });
  await app.register(withdrawalRoutes, { prefix: '/api' });
  await app.register(binaryRoutes, { prefix: '/api', service: binaryService });
  await app.register(binaryAiRoutes, { prefix: '/api', service: aiService });
});

afterAll(async () => {
  tradingLoop.stop();
  aiService.dispose();
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('whole-system journey (classic + binary + wallet + Tron)', () => {
  it('runs the full user journey end to end', async () => {
    // 1. Fresh account summary.
    const summary0 = await app.inject({ method: 'GET', url: '/api/account/summary' });
    expect(summary0.json().account.cashBalance).toBe(0);
    expect(summary0.json().binaryNetPnl).toBe(0);

    // 2. Deposit paper funds.
    const deposit = await app.inject({
      method: 'POST',
      url: '/api/paper/deposit',
      payload: { amount: 1000 },
    });
    expect(deposit.statusCode).toBe(201);
    expect(deposit.json().account.cashBalance).toBe(1000);

    // 3. Enable trading.
    const start = await app.inject({ method: 'POST', url: '/api/trading/start' });
    expect(start.statusCode).toBe(200);
    expect(start.json().running).toBe(true);

    // 4. Binary quote (needs a fresh tick).
    feed.push(100);
    const quote = await app.inject({
      method: 'GET',
      url: '/api/binary/quote?stake=10&duration=5&payoutRatio=0.8',
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json().potentialProfit).toBe(8);

    // 5. Open a binary contract.
    const open = await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { asset: 'BTC/USDT', direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });
    expect(open.statusCode).toBe(201);
    const contract = open.json();
    expect(contract.status).toBe('OPEN');
    expect(contract.entryPrice).toBe(100);

    // 6. Open contracts listed; stake locked.
    const openList = await app.inject({ method: 'GET', url: '/api/binary/open' });
    expect(openList.json()).toHaveLength(1);
    expect(repo.getAccount().lockedBalance).toBe(10);

    // 7. Settle WIN after expiry.
    feed.push(105, new Date(new Date(contract.expiresAt).getTime() + 50).toISOString());
    binaryService.settleDueContracts(new Date(new Date(contract.expiresAt).getTime() + 100).toISOString());

    const summary1 = await app.inject({ method: 'GET', url: '/api/account/summary' });
    expect(summary1.json().account.equity).toBe(1008);
    expect(summary1.json().account.lockedBalance).toBe(0);
    expect(summary1.json().binaryNetPnl).toBe(8);

    const binarySummary = await app.inject({ method: 'GET', url: '/api/binary/summary' });
    expect(binarySummary.json()).toMatchObject({ wins: 1, losses: 0, openCount: 0 });

    // 8. Withdraw via Tron USDT (simulated).
    const withdraw = await app.inject({
      method: 'POST',
      url: '/api/withdrawals',
      payload: { amount: 100, destinationAddress: TRON_ADDRESS, confirmed: true },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().withdrawal.status).toBe('SIMULATED');
    expect(withdraw.json().withdrawal.network).toBe('TRON');
    expect(withdraw.json().account.cashBalance).toBe(908);

    // 9. Deposit info + classic endpoints still healthy.
    const info = await app.inject({ method: 'GET', url: '/api/deposits/info' });
    expect(info.json()).toMatchObject({ network: 'TRON', asset: 'USDT', tokenStandard: 'TRC20' });

    const positions = await app.inject({ method: 'GET', url: '/api/positions' });
    expect(positions.statusCode).toBe(200);

    const decisions = await app.inject({ method: 'GET', url: '/api/ai/decisions' });
    expect(decisions.statusCode).toBe(200);

    // 10. Stop trading.
    const stop = await app.inject({ method: 'POST', url: '/api/trading/stop' });
    expect(stop.json()).toEqual({ running: false });
  });

  it('emits SSE events for the journey actions', async () => {
    const { subscribeToEvents } = await import('../src/events/eventBus.js');
    const events: ApiEvent[] = [];
    const unsubscribe = subscribeToEvents((event) => events.push(event));

    // The journey test stopped trading; re-enable it for this test and
    // reset the loss-limit baseline (equity dropped during the journey).
    repo.updateAccount({ startingEquity: 900 });
    await app.inject({ method: 'POST', url: '/api/trading/start' });

    feed.push(200);
    await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { asset: 'BTC/USDT', direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });

    const types = events.map((event) => event.type);
    expect(types).toContain('binary');
    expect(types).toContain('account');
    unsubscribe();
  });

  it('runs the AI binary journey: signals, auto-executed contract, stop', async () => {
    // Ensure a clean slate for AI decisions and a funded, trading account.
    connection.getDb().prepare('DELETE FROM ai_binary_decisions').run();
    connection.getDb().prepare("DELETE FROM binary_contracts WHERE status = 'OPEN'").run();
    repo.updateAccount({
      cashBalance: 500,
      lockedBalance: 0,
      equity: 500,
      tradingEnabled: true,
      startingEquity: 500,
    });
    feed.reset();
    // 1. SIGNAL_ONLY: the AI stores signals but opens nothing.
    let res = await app.inject({
      method: 'PUT',
      url: '/api/binary-ai/settings',
      payload: { mode: 'SIGNAL_ONLY' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('SIGNAL_ONLY');

    res = await app.inject({ method: 'POST', url: '/api/binary-ai/start' });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(true);

    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      feed.push(100 * (1 + 0.001 * i), new Date(now - (14 - i) * 1000).toISOString());
    }
    aiService.evaluateOnce();

    let decisions = await app.inject({ method: 'GET', url: '/api/binary-ai/decisions?limit=5' });
    const rows = decisions.json() as Array<{ signal: string; autoExecuted: boolean }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.signal).toBe('UP');
    expect(rows[0]!.autoExecuted).toBe(false);

    let contracts = await app.inject({ method: 'GET', url: '/api/binary/open' });
    expect((contracts.json() as unknown[]).length).toBe(0);

    // 2. AUTO_EXECUTE: the AI opens a Phase 6.2 contract with source AI_BINARY.
    res = await app.inject({
      method: 'PUT',
      url: '/api/binary-ai/settings',
      payload: { mode: 'AUTO_EXECUTE', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });
    expect(res.json().mode).toBe('AUTO_EXECUTE');

    aiService.evaluateOnce();

    contracts = await app.inject({ method: 'GET', url: '/api/binary/open' });
    const open = contracts.json() as Array<{ id: number; source: string; stakeUsd: number }>;
    expect(open.length).toBe(1);
    expect(open[0]!.source).toBe('AI_BINARY');
    expect(open[0]!.stakeUsd).toBe(10);

    decisions = await app.inject({ method: 'GET', url: '/api/binary-ai/decisions?limit=5' });
    const updated = decisions.json() as Array<{ autoExecuted: boolean; binaryContractId: number }>;
    expect(updated[0]!.autoExecuted).toBe(true);
    expect(updated[0]!.binaryContractId).toBe(open[0]!.id);

    // The ledger records the AI stake lock.
    const ledger = connection
      .getDb()
      .prepare<[], { type: string }>('SELECT type FROM transactions ORDER BY id DESC LIMIT 1')
      .get();
    expect(ledger?.type).toBe('AI_BINARY_STAKE_LOCKED');

    // 3. Stop: running flips off with a user stop reason.
    res = await app.inject({ method: 'POST', url: '/api/binary-ai/stop' });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(false);
    expect((res.json().warnings as string[]).some((warning) => warning.includes('stopped'))).toBe(
      true,
    );
  });
});

