import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-binary-session-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let publishEvent: typeof import('../src/events/eventBus.js')['publishEvent'];
let getBinarySessionService: typeof import('../src/binary/binarySessionService.js')['getBinarySessionService'];

class StubFeed {
  private readonly ticks: PriceTick[] = [];

  push(price: number): void {
    this.ticks.push({ price, timestamp: new Date().toISOString(), source: 'STUB' });
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

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  publishEvent = (await import('../src/events/eventBus.js')).publishEvent;
  getBinarySessionService = (await import('../src/binary/binarySessionService.js'))
    .getBinarySessionService;
  const { BinaryService } = await import('../src/binary/binaryService.js');
  const { binaryRoutes } = await import('../src/binary/binaryRoutes.js');
  connection.initDb();

  const feed = new StubFeed();
  feed.push(67000);
  const service = new BinaryService(feed);

  app = Fastify();
  await app.register(binaryRoutes, { prefix: '/api', service });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: true,
    startingEquity: 500,
    binarySessionGainLimitEnabled: true,
    binaryMaxSessionGainUsdc: 50,
    binaryMaxSessionGainPercent: 0,
  });
  connection.getDb().prepare('DELETE FROM binary_contracts').run();
  getBinarySessionService().resetSession();
});

describe('binary session gain routes', () => {
  it('GET /api/binary/session-stats returns the session statistics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/binary/session-stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.combinedNetGain).toBe(0);
    expect(body.gainLimitEnabled).toBe(true);
    expect(body.maxSessionGainUsdc).toBe(50);
    expect(body.remainingSessionGain).toBe(50);
    expect(body.gainLimitReached).toBe(false);
  });

  it('PUT /api/binary/session-settings updates and validates the limits', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/binary/session-settings',
      payload: { gainLimitEnabled: true, maxSessionGainUsdc: 75, maxSessionGainPercent: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().maxSessionGainUsdc).toBe(75);
    expect(res.json().maxSessionGainPercent).toBe(10);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/binary/session-settings',
      payload: { maxSessionGainUsdc: -1 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('POST /api/binary/session-reset zeroes the session', async () => {
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 1, source: 'MANUAL_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 60 },
    });
    const res = await app.inject({ method: 'POST', url: '/api/binary/session-reset' });
    expect(res.statusCode).toBe(200);
    expect(res.json().combinedNetGain).toBe(0);
    expect(res.json().gainLimitReached).toBe(false);
  });

  it('blocks POST /api/binary/open with 400 when the session gain limit is reached', async () => {
    publishEvent('binary', {
      action: 'SETTLED',
      contract: { id: 2, source: 'MANUAL_BINARY', result: 'WIN', stakeUsd: 10, potentialProfitUsd: 60 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { asset: 'BTC/USDC', direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('session gain limit');

    // Reset unblocks the same request.
    await app.inject({ method: 'POST', url: '/api/binary/session-reset' });
    const retry = await app.inject({
      method: 'POST',
      url: '/api/binary/open',
      payload: { asset: 'BTC/USDC', direction: 'UP', stakeUsd: 10, durationSeconds: 5, payoutRatio: 0.8 },
    });
    expect(retry.statusCode).toBe(201);
  });
});
