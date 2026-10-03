/**
 * Phase 7 — UAT reset CLI (Docker only).
 *
 *   docker compose run --rm \
 *     -e UAT_RESET_CONFIRM=YES \
 *     -e UAT_RESET_STARTING_BALANCE_USDC=1000 \
 *     dev pnpm --filter server reset:uat
 *
 * Env:
 *   UAT_RESET_CONFIRM=YES                 required
 *   UAT_RESET_STARTING_BALANCE_USDC=1000  default 0
 *   UAT_RESET_ALLOW_LIVE=true             required only when MODE=LIVE
 *   UAT_RESET_BACKUP=false                skip the automatic pre-reset backup
 *   BACKUP_DIR=/app/backups               where the backup goes
 *
 * Stop the API server first (or restart it afterwards) so no in-memory state
 * refers to the wiped rows.
 */
import fs from 'node:fs';
import path from 'node:path';

import { assertUatResetAllowed, runUatReset, UatResetError, verifyUatReset } from '../admin/uatReset.js';
import { config } from '../config.js';
import { closeDb, getDb, initDb } from '../db/connection.js';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const startingBalanceUsdc = Number(process.env['UAT_RESET_STARTING_BALANCE_USDC'] ?? '0');
  const options = {
    mode: config.MODE,
    confirm: process.env['UAT_RESET_CONFIRM'],
    allowLive: process.env['UAT_RESET_ALLOW_LIVE'],
    startingBalanceUsdc,
    defaults: {
      baseCurrency: config.BASE_CURRENCY,
      fixedTradeSizeUsd: config.FIXED_TRADE_SIZE_USD,
      lossLimitPercent: config.LOSS_LIMIT_PERCENT,
      maxOptionStakeUsd: config.MAX_OPTION_STAKE_USD,
      optionDefaultDurationSeconds: config.OPTION_DEFAULT_DURATION_SECONDS,
    },
  };

  // Validate BEFORE touching (or even creating) the database.
  try {
    assertUatResetAllowed(options);
  } catch (err) {
    if (err instanceof UatResetError) {
      out(`REFUSED (${err.code}): ${err.message}`);
      return 2;
    }
    throw err;
  }

  out(`UAT reset — mode=${config.MODE} tron=${config.TRON_MODE} db=${config.DB_PATH}`);
  initDb(); // runs migrations → schema is present and current

  if (process.env['UAT_RESET_BACKUP'] !== 'false' && fs.existsSync(config.DB_PATH)) {
    const dir = process.env['BACKUP_DIR'] ?? path.resolve(path.dirname(config.DB_PATH), '..', 'backups');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dir, `trading-pre-uat-reset-${stamp}.db`);
    await getDb().backup(target); // consistent online backup (WAL-safe)
    fs.chmodSync(target, 0o600);
    out(`backup written: ${target}`);
  }

  const result = runUatReset(getDb(), options);
  out(`cleared rows: ${JSON.stringify(result.clearedRows)}`);
  const verification = verifyUatReset(getDb(), result.startingBalanceUsdc);
  out(`row counts: ${JSON.stringify(verification.counts)}`);
  out(`app_settings: ${JSON.stringify(verification.settings)}`);
  closeDb();

  if (!verification.ok) {
    out(`VERIFY FAILED:\n  - ${verification.problems.join('\n  - ')}`);
    return 1;
  }
  out(`UAT RESET OK — starting balance ${result.startingBalanceUsdc} ${config.BASE_CURRENCY}, trading disabled`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    out(`UAT reset failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
