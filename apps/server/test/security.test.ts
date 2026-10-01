import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-security-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let buildApp: typeof import('../src/app.js')['buildApp'];
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  buildApp = (await import('../src/app.js')).buildApp;
  connection.initDb();
  repo.updateAccount({ tradingEnabled: false });
});

afterAll(async () => {
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('security hardening', () => {
  it('sets baseline security headers on every response', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });

  it('rejects market symbols that could inject into upstream URLs', async () => {
    const app = await buildApp();
    const bad = [
      '../admin',
      'BTC/USDC?granularity=1',
      'BTC%2F..%2F..%2Fetc',
      'a/b/c',
    ];
    for (const symbol of bad) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/market/candles?symbol=${encodeURIComponent(symbol)}`,
      });
      expect(res.statusCode).toBe(400);
    }
    // A well-formed symbol still parses (may fail upstream, but never 400s on validation).
    const ok = await app.inject({
      method: 'GET',
      url: '/api/market/candles?symbol=BTC/USDT&interval=1m&limit=5',
    });
    expect([200, 502]).toContain(ok.statusCode);
    await app.close();
  });

  it('rejects SQL-injection attempts in the wallet records filter', async () => {
    const app = await buildApp();
    const attacks = [
      "DEPOSIT'; DROP TABLE risk_events;--",
      'DEPOSIT OR 1=1',
      "'; SELECT * FROM account; --",
    ];
    for (const attack of attacks) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/wallet/records?type=${encodeURIComponent(attack)}`,
      });
      expect(res.statusCode).toBe(400);
    }
    // The risk_events table survived (nothing was dropped).
    const table = connection
      .getDb()
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM risk_events')
      .get();
    expect(table?.count).toBeGreaterThanOrEqual(0);
    // Direct repository calls with hostile kinds degrade safely to ALL.
    const rows = repo.listWalletRecords("DEPOSIT'; DROP TABLE x;--", 10, 0);
    expect(Array.isArray(rows)).toBe(true);
    await app.close();
  });

  it('allows only one settlement claim per position', () => {
    repo.updateAccount({
      tradingEnabled: true,
      equity: 500,
      cashBalance: 500,
      startingEquity: 500,
    });
    const position = repo.createPosition({
      symbol: 'TEST',
      side: 'CALL',
      strikePrice: 100,
      expiry: '2026-12-31',
      quantity: 1,
      entryPremium: 10,
      openedAt: new Date().toISOString(),
    });
    expect(repo.claimPositionForSettlement(position.id)).toBe(true);
    // A second (concurrent) settlement attempt loses the claim.
    expect(repo.claimPositionForSettlement(position.id)).toBe(false);
    expect(repo.claimPositionForSettlement(position.id)).toBe(false);
    repo.updatePosition(position.id, { status: 'CLOSED', closedAt: new Date().toISOString() });
  });

  it('never exposes private keys through Tron endpoints', async () => {
    const app = await buildApp();
    for (const url of ['/api/tron/status', '/api/tron/health']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const body = res.body.toLowerCase();
      expect(body).not.toContain('private');
      expect(body).not.toContain('secret');
      expect(body).not.toMatch(/[0-9a-f]{64}/); // hex private-key shape
    }
    await app.close();
  });
});
