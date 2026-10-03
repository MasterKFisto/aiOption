import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-option-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

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
  const { OptionService } = await import('../src/options/optionService.js');
  const { optionRoutes } = await import('../src/options/optionRoutes.js');
  connection.initDb();

  const feed = new StubFeed();
  feed.push(67000);
  const service = new OptionService(feed);

  app = Fastify();
  await app.register(optionRoutes, { prefix: '/api', service });
  repo.updateAccount({
    tradingEnabled: true,
    equity: 500,
    cashBalance: 500,
    lockedBalance: 0,
    startingEquity: 500,
    maxOptionStakeUsd: 100,
    optionDefaultDurationSeconds: 600,
  });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('option routes', () => {
  it('GET /api/options/config returns the Phase 6.4 limits', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/options/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      minStakeUsd: 1,
      maxStakeUsd: 100,
      defaultStakeUsd: 10,
      allowedDurationsSeconds: [60, 180, 300, 600, 900, 1800, 3600],
      defaultDurationSeconds: 600,
      maxDurationSeconds: 3600,
    });
  });

  it('POST /api/options/open opens a contract with an explicit expiry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/options/open',
      payload: { asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 60 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('OPEN');
    expect(body.durationSeconds).toBe(60);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('rejects invalid payloads with 400', async () => {
    const cases = [
      { asset: 'BTC/USDT', side: 'SIDEWAYS', stakeUsd: 10, durationSeconds: 60 },
      { asset: 'BTC/USDT', side: 'CALL', stakeUsd: 0, durationSeconds: 60 },
      { asset: 'BTC/USDT', side: 'CALL', stakeUsd: 10, durationSeconds: 7 },
      { asset: 'BTC/USDT', side: 'CALL', stakeUsd: 150, durationSeconds: 60 },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/options/open',
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
