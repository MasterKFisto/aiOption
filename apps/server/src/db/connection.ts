import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { runMigrations } from './migrations.js';

let db: Database.Database | undefined;

/**
 * Opens (once) the SQLite database at config.DB_PATH, enables WAL mode and
 * foreign keys, and runs pending migrations. Safe to call multiple times.
 */
export function initDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = config.DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  logger.info({ dbPath }, 'database ready (WAL, foreign keys on)');
  return db;
}

/** Returns the initialized database handle. Throws if initDb() wasn't called. */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized — call initDb() first');
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
