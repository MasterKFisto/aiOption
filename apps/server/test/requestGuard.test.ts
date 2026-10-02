import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createOriginMatcher, hostnameOf } from '../src/security/requestGuard.js';

/**
 * Security regression tests (Phase 6.5.1 audit): CSRF via cross-site
 * "simple" requests and DNS rebinding via a foreign Host header. Runs
 * against the real app (buildApp) so the guard covers every route.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-guard-test-'));

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let connection: typeof import('../src/db/connection.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  const live = await import('../src/market/liveMarketDataService.js');
  vi.spyOn(live.liveMarket, 'start').mockImplementation(() => undefined);
  connection = await import('../src/db/connection.js');
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const STATE_CHANGING_ROUTES = [
  '/api/classic/trading/start',
  '/api/classic/trading/stop',
  '/api/trading/start',
  '/api/trading/stop',
  '/api/classic/repair-locked-balance',
  '/api/binary/session-reset',
  '/api/binary-ai/start',
  '/api/deposits/simulate',
  '/api/tron/simulate-trx-deposit',
  '/api/withdrawals',
];

describe('createOriginMatcher (shared by CORS + CSRF guard)', () => {
  const matches = createOriginMatcher(['http://localhost:5173']);

  it('treats loopback aliases of the configured origin as the same app', () => {
    // Regression: the UI opened at http://127.0.0.1:5173 got "cross-site request blocked".
    for (const origin of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
      'HTTP://LOCALHOST:5173',
      'http://localhost:5173/',
    ]) {
      expect(matches(origin), origin).toBe(true);
    }
  });

  it('still rejects other ports, schemes, lookalike and foreign hosts', () => {
    for (const origin of [
      'http://localhost:3000',
      'https://localhost:5173',
      'http://127.0.0.2:5173',
      'http://localhost.evil.example:5173',
      'http://127.0.0.1.nip.io:5173',
      'http://evil.example',
      'null',
      'file://',
      '',
    ]) {
      expect(matches(origin), origin).toBe(false);
    }
  });
});

describe('hostnameOf', () => {
  it('strips ports and IPv6 brackets', () => {
    expect(hostnameOf('localhost:8080')).toBe('localhost');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:8080')).toBe('::1');
    expect(hostnameOf('LOCALHOST:5173')).toBe('localhost');
  });
});

describe('CSRF guard', () => {
  it('blocks cross-site state-changing requests from a foreign Origin (any content type)', async () => {
    for (const url of STATE_CHANGING_ROUTES) {
      const textPlain = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
        payload: '{}',
      });
      expect(textPlain.statusCode, `${url} text/plain`).toBe(403);
      const noBody = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'https://evil.example' },
      });
      expect(noBody.statusCode, `${url} no body`).toBe(403);
    }
    for (const url of ['/api/wallet/addresses', '/api/classic/settings']) {
      const res = await app.inject({
        method: 'PUT',
        url,
        headers: { origin: 'https://evil.example' },
        payload: { usdcTradeAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
      });
      expect(res.statusCode, url).toBe(403);
    }
    // Nothing changed.
    const addresses = (await app.inject({ method: 'GET', url: '/api/wallet/addresses' })).json();
    expect(addresses.usdcTradeAddressSource).toBe('SIMULATED');
  });

  it('blocks "null" origins and Sec-Fetch-Site: cross-site without Origin', async () => {
    const nullOrigin = await app.inject({
      method: 'POST',
      url: '/api/classic/trading/stop',
      headers: { origin: 'null' },
    });
    expect(nullOrigin.statusCode).toBe(403);
    const fetchSite = await app.inject({
      method: 'POST',
      url: '/api/classic/trading/stop',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(fetchSite.statusCode).toBe(403);
  });

  it('returns a clear, actionable message and a machine-readable code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/classic/trading/stop',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CROSS_SITE_BLOCKED');
    expect(res.json().error).toMatch(/did not come from the AI Option app/);
    expect(res.json().error).toMatch(/http:\/\/localhost:5173/);
  });

  it('allows the UI opened as localhost, 127.0.0.1 or [::1] (deposit simulate regression)', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/deposits/simulate',
        headers: { origin },
        payload: { amount: 1 },
      });
      expect(res.statusCode, origin).toBe(200);
      // CORS agrees with the guard.
      expect(res.headers['access-control-allow-origin'], origin).toBe(origin);
    }
  });

  it('allows the configured UI origin, same-origin and non-browser clients', async () => {
    const ui = await app.inject({
      method: 'POST',
      url: '/api/classic/trading/stop',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(ui.statusCode).toBe(200);
    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/classic/trading/stop',
      headers: { origin: 'http://localhost:8080', host: 'localhost:8080' },
    });
    expect(sameOrigin.statusCode).toBe(200);
    const curl = await app.inject({ method: 'POST', url: '/api/classic/trading/stop' });
    expect(curl.statusCode).toBe(200);
  });

  it('never blocks reads (GET) from a foreign origin — CORS hides the response instead', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('DNS-rebinding guard (Host allow-list)', () => {
  it('rejects requests addressed to a foreign hostname', async () => {
    for (const host of ['attacker.example', 'attacker.example:8080', '192.168.1.50:8080']) {
      const res = await app.inject({ method: 'GET', url: '/api/wallet/addresses', headers: { host } });
      expect(res.statusCode, host).toBe(403);
    }
  });

  it('accepts localhost, 127.0.0.1 and [::1]', async () => {
    for (const host of ['localhost:8080', '127.0.0.1:8080', '[::1]:8080']) {
      const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });
});
