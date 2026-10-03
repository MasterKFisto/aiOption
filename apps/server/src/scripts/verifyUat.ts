/**
 * Phase 7 — read-only post-reset verification (Docker only).
 *
 *   docker compose run --rm dev pnpm --filter server verify:uat
 *   (optional) -e UAT_EXPECT_BALANCE_USDC=1000
 *
 * Exit code 0 = clean; 1 = problems found (listed).
 */
import fs from 'node:fs';

import Database from 'better-sqlite3';

import { verifyUatReset } from '../admin/uatReset.js';
import { config } from '../config.js';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

if (!fs.existsSync(config.DB_PATH)) {
  out(`database not found: ${config.DB_PATH}`);
  process.exit(1);
}
const db = new Database(config.DB_PATH, { readonly: true, fileMustExist: true });
const expectedRaw = process.env['UAT_EXPECT_BALANCE_USDC'];
const result = verifyUatReset(db, expectedRaw === undefined ? undefined : Number(expectedRaw));
db.close();

out(`row counts: ${JSON.stringify(result.counts)}`);
out(`account: ${JSON.stringify(result.account)}`);
out(`app_settings: ${JSON.stringify(result.settings)}`);
if (result.ok) {
  out('VERIFY OK — database is in a clean post-reset state');
  process.exit(0);
}
out(`VERIFY FAILED:\n  - ${result.problems.join('\n  - ')}`);
process.exit(1);
