import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PriceTick } from '@aioption/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-ai-live-gate-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

class StubFeed {
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

describe('AI binary LIVE-mode safety gate', () => {
  beforeAll(async () => {
    vi.resetModules();
    process.env['DB_PATH'] = dbPath;
    process.env['TRADING_MODE'] = 'LIVE';
    // Phase 7: LIVE mode requires an explicit real-funds acknowledgement.
    process.env['LIVE_MODE_CONFIRM'] = 'I_UNDERSTAND_REAL_FUNDS';
    process.env['AI_BINARY_ENABLED'] = 'true';
    process.env['AI_BINARY_LIVE_AUTO_TRADING_ENABLED'] = 'false';
    const connection = await import('../src/db/connection.js');
    connection.initDb();
    const repo = await import('../src/db/repositories.js');
    repo.updateAccount({
      cashBalance: 500,
      lockedBalance: 0,
      equity: 500,
      tradingEnabled: true,
      startingEquity: 500,
    });
  });

  afterAll(async () => {
    const connection = await import('../src/db/connection.js');
    connection.closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs under MODE=LIVE with the default safety flags', async () => {
    const { config } = await import('../src/config.js');
    expect(config.MODE).toBe('LIVE');
    expect(config.AI_BINARY_LIVE_AUTO_TRADING_ENABLED).toBe(false);
  });

  it('rejects switching the mode to AUTO_EXECUTE in LIVE mode', async () => {
    const { AiBinaryService } = await import('../src/binary-ai/binaryAiService.js');
    const { BinaryService } = await import('../src/binary/binaryService.js');
    const feed = new StubFeed();
    const service = new AiBinaryService(feed, new BinaryService(feed));

    expect(() => service.updateSettings({ mode: 'AUTO_EXECUTE' })).toThrow(
      /AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true/,
    );
    service.dispose();
  });

  it('rejects start in AUTO_EXECUTE mode in LIVE mode', async () => {
    const { AiBinaryService } = await import('../src/binary-ai/binaryAiService.js');
    const { BinaryService } = await import('../src/binary/binaryService.js');
    const { saveAiBinarySettings } = await import(
      '../src/binary-ai/binaryAiRepository.js'
    );
    // Simulate a previously persisted AUTO_EXECUTE setting.
    saveAiBinarySettings({ mode: 'AUTO_EXECUTE' });
    const feed = new StubFeed();
    const service = new AiBinaryService(feed, new BinaryService(feed));

    expect(service.getStatus().mode).toBe('AUTO_EXECUTE');
    expect(() => service.start()).toThrow(/AI_BINARY_LIVE_AUTO_TRADING_ENABLED=true/);
    service.dispose();
    saveAiBinarySettings({ mode: 'SIGNAL_ONLY' });
  });

  it('allows SIGNAL_ONLY in LIVE mode: signals stored, no contracts opened', async () => {
    const { AiBinaryService } = await import('../src/binary-ai/binaryAiService.js');
    const { BinaryService } = await import('../src/binary/binaryService.js');
    const connection = await import('../src/db/connection.js');
    const feed = new StubFeed();
    const service = new AiBinaryService(feed, new BinaryService(feed));

    service.updateSettings({ mode: 'SIGNAL_ONLY' });
    service.start();
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      feed.push(100 * (1 + 0.001 * i), new Date(now - (14 - i) * 1000).toISOString());
    }
    service.evaluateOnce();

    const status = service.getStatus();
    expect(status.running).toBe(true);
    expect(status.sessionStats.totalSignals).toBe(1);

    const count = connection
      .getDb()
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM binary_contracts')
      .get()?.count;
    expect(count).toBe(0);

    service.stop();
    service.dispose();
  });
});
