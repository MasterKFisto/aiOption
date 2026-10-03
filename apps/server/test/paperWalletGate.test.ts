import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Security regression (Phase 6.5.2 audit): the paper wallet must not be able
 * to mint or remove balance when the app runs against a real network.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aioption-paper-gate-'));

let app: ReturnType<typeof Fastify>;
let connection: typeof import('../src/db/connection.js');
let repo: typeof import('../src/db/repositories.js');

beforeAll(async () => {
  vi.resetModules();
  process.env['DB_PATH'] = path.join(tmpDir, 'trading.db');
  process.env['TRADING_MODE'] = 'LIVE';
  process.env['TRON_MODE'] = 'MAINNET';
  connection = await import('../src/db/connection.js');
  repo = await import('../src/db/repositories.js');
  const { walletRoutes } = await import('../src/routes/walletRoutes.js');
  connection.initDb();
  app = Fastify();
  await app.register(walletRoutes, { prefix: '/api/paper' });
});

afterAll(async () => {
  await app.close();
  connection.closeDb();
  delete process.env['TRADING_MODE'];
  delete process.env['TRON_MODE'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('paper wallet gate in LIVE/MAINNET mode', () => {
  it('rejects paper deposits and withdrawals with 403 and changes nothing', async () => {
    const before = repo.getAccount();
    for (const url of ['/api/paper/deposit', '/api/paper/withdraw']) {
      const res = await app.inject({ method: 'POST', url, payload: { amount: 1_000_000 } });
      expect(res.statusCode, url).toBe(403);
    }
    const after = repo.getAccount();
    expect(after.equity).toBe(before.equity);
    expect(after.cashBalance).toBe(before.cashBalance);
  });

  it('still allows reading balances', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/paper/balances' });
    expect(res.statusCode).toBe(200);
  });
});
