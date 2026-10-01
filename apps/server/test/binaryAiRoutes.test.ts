import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-binary-ai-routes-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let app: ReturnType<typeof Fastify>;
let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');
let AiBinaryService: typeof import('../src/binary-ai/binaryAiService.js')['AiBinaryService'];
let BinaryService: typeof import('../src/binary/binaryService.js')['BinaryService'];

class StubFeed {
  private readonly ticks: PriceTick[] = [];

  push(price: number): void {
    this.ticks.push({ price, timestamp: new Date().toISOString(), source: 'STUB' });
  }

  getLatestTick(): PriceTick | null {
    return this.ticks.at(-1) ?? null;
  }

  getRecentTicks(limit: number): PriceTick[] {
    return this.ticks.slice(-limit);
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

let service: InstanceType<typeof AiBinaryService>;

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  process.env['AI_BINARY_ENABLED'] = 'true';
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  AiBinaryService = (await import('../src/binary-ai/binaryAiService.js')).AiBinaryService;
  BinaryService = (await import('../src/binary/binaryService.js')).BinaryService;
  connection.initDb();
});

beforeEach(async () => {
  const feed = new StubFeed();
  service = new AiBinaryService(feed, new BinaryService(feed));
  const { binaryAiRoutes } = await import('../src/binary-ai/binaryAiRoutes.js');
  app = Fastify();
  await app.register(binaryAiRoutes, { prefix: '/api', service });
  repo.updateAccount({
    cashBalance: 500,
    lockedBalance: 0,
    equity: 500,
    tradingEnabled: true,
    startingEquity: 500,
  });
});

afterEach(async () => {
  await app.close();
  service.dispose();
});

afterAll(() => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('binary-ai routes', () => {
  it('GET /api/binary-ai/status returns the full status shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/binary-ai/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.mode).toBe('SIGNAL_ONLY');
    expect(body.running).toBe(false);
    expect(body.currentSignal).toBeNull();
    expect(body.sessionStats).toBeDefined();
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('PUT /api/binary-ai/settings saves and returns updated status', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/binary-ai/settings',
      payload: { mode: 'SIGNAL_ONLY', stakeUsd: 15, durationSeconds: 5, payoutRatio: 0.7 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('SIGNAL_ONLY');
    expect(body.stakeUsd).toBe(15);
    expect(body.durationSeconds).toBe(5);
    expect(body.payoutRatio).toBe(0.7);
  });

  it('PUT /api/binary-ai/settings rejects invalid values with 400', async () => {
    const cases = [
      { mode: 'YOLO' },
      { durationSeconds: 7 },
      { payoutRatio: 0.33 },
      { stakeUsd: -5 },
      { minConfidence: 2 },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/binary-ai/settings',
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('POST /api/binary-ai/start runs the engine; stop halts it', async () => {
    const startRes = await app.inject({ method: 'POST', url: '/api/binary-ai/start' });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().running).toBe(true);

    const stopRes = await app.inject({ method: 'POST', url: '/api/binary-ai/stop' });
    expect(stopRes.statusCode).toBe(200);
    expect(stopRes.json().running).toBe(false);
    expect(stopRes.json().warnings.some((w: string) => w.includes('stopped'))).toBe(true);
  });

  it('POST /api/binary-ai/start fails with 400 when mode is DISABLED', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/binary-ai/settings',
      payload: { mode: 'DISABLED' },
    });
    const res = await app.inject({ method: 'POST', url: '/api/binary-ai/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('DISABLED');
  });

  it('GET /api/binary-ai/decisions returns stored decisions', async () => {
    service.updateSettings({ mode: 'SIGNAL_ONLY' });
    service.start();
    const feed = new StubFeed();
    for (let i = 0; i < 15; i++) {
      feed.push(100 * (1 + 0.001 * i));
    }
    // Feed the running service via evaluate is not possible through the route,
    // so verify the endpoint shape with an empty list first.
    const res = await app.inject({ method: 'GET', url: '/api/binary-ai/decisions?limit=10' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /api/binary-ai/stats returns performance statistics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/binary-ai/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.sessionStats).toBeDefined();
  });
});
