import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-app-test-'));
const dbPath = path.join(tmpDir, 'trading.db');

let buildApp: typeof import('../src/app.js')['buildApp'];
let repo: typeof import('../src/db/repositories.js');
let connection: typeof import('../src/db/connection.js');
let tradingLoop: typeof import('../src/scheduler/tradingLoop.js')['tradingLoop'];

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = dbPath;
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  buildApp = (await import('../src/app.js')).buildApp;
  tradingLoop = (await import('../src/scheduler/tradingLoop.js')).tradingLoop;
  connection.initDb();
});

afterAll(() => {
  tradingLoop.stop();
  connection.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildApp', () => {
  it('does not start the trading loop when trading is disabled in the DB', async () => {
    repo.updateAccount({ tradingEnabled: false });
    const app = await buildApp();
    expect(tradingLoop.isRunning).toBe(false);

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().database).toBe('ok');
    await app.close();
  });

  it('starts the trading loop on boot when trading is enabled in the DB', async () => {
    repo.updateAccount({ tradingEnabled: true, startingEquity: 100, equity: 100 });
    const app = await buildApp();
    expect(tradingLoop.isRunning).toBe(true);

    const status = await app.inject({ method: 'GET', url: '/api/trading/status' });
    expect(status.json().running).toBe(true);
    await app.close();
  });

  it('restricts CORS to the configured frontend origin', async () => {
    repo.updateAccount({ tradingEnabled: false });
    const app = await buildApp();

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://evil.example.com' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    // Cross-origin preflight for a state-changing route must not be allowed.
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/trading/start',
      headers: {
        origin: 'http://evil.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });
});
