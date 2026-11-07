import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

function fail(message: string): never {
  console.error(`[restore] ${message}`);
  process.exit(1);
}

function validateBackup(db: Database.Database): void {
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('SQLite integrity_check failed');
  }

  const requiredTables = [
    'users', 'services', 'counters', 'counter_services', 'staff_assignments',
    'tickets', 'queue_events', 'system_settings', 'ads', 'backups',
    'sessions', 'visitor_categories', 'ticket_sequences', 'schema_migrations',
  ];
  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((row) => row.name),
  );
  const missingTables = requiredTables.filter((name) => !existingTables.has(name));
  if (missingTables.length) {
    throw new Error(`Not a complete Infinity Services database; missing tables: ${missingTables.join(', ')}`);
  }

  // Require the foundational schema only. Later migrations are deliberately
  // allowed to be absent: the server applies pending migrations on next startup.
  const requiredMigrations = ['001_initial_schema.sql', '002_auth_priority.sql'];
  const appliedMigrations = new Set(
    (db.prepare('SELECT filename FROM schema_migrations').all() as { filename: string }[])
      .map((row) => row.filename),
  );
  const missingMigrations = requiredMigrations.filter((name) => !appliedMigrations.has(name));
  if (missingMigrations.length) {
    throw new Error(`Backup is missing required schema migrations: ${missingMigrations.join(', ')}`);
  }
}

const filename = process.argv[2];
if (!filename || path.basename(filename) !== filename || !/^infinity-backup-[\dTZ-]+\.db$/.test(filename)) {
  fail('Usage: npm run db:restore -- infinity-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db');
}
const backupPath = path.resolve(config.backupsDir, filename);
const dbPath = path.resolve(config.dbPath);
if (!backupPath.startsWith(path.resolve(config.backupsDir) + path.sep) || !fs.existsSync(backupPath)) {
  fail('Backup file not found in the configured local backups folder.');
}
if (!fs.existsSync(dbPath)) fail('Current database does not exist; use the normal first-run setup instead.');
if (fs.realpathSync(backupPath) === fs.realpathSync(dbPath)) fail('Backup cannot be the live database file.');

console.log('[restore] IMPORTANT: stop the queue server before running this command.');
const candidate = new Database(backupPath, { readonly: true, fileMustExist: true });
try {
  validateBackup(candidate);
} catch (err) {
  fail(`Backup validation failed; current database was not changed. ${err instanceof Error ? err.message : String(err)}`);
} finally {
  candidate.close();
}

const safetyName = `infinity-pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
const safetyPath = path.join(config.backupsDir, safetyName);
const live = new Database(dbPath);
try {
  await live.backup(safetyPath);
} finally {
  live.close();
}

const tempPath = `${dbPath}.restore-tmp`;
let tempCreated = false;
try {
  fs.copyFileSync(backupPath, tempPath, fs.constants.COPYFILE_EXCL);
  tempCreated = true;
  const check = new Database(tempPath, { readonly: true, fileMustExist: true });
  try {
    validateBackup(check);
  } finally {
    check.close();
  }
  const rollbackPath = `${dbPath}.pre-restore`;
  if (fs.existsSync(rollbackPath)) throw new Error('A previous restore rollback file already exists; move it aside before retrying.');
  fs.renameSync(dbPath, rollbackPath);
  try {
    fs.renameSync(tempPath, dbPath);
  } catch (replaceError) {
    fs.renameSync(rollbackPath, dbPath);
    throw replaceError;
  }
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  fs.rmSync(rollbackPath, { force: true });
  console.log(`[restore] Database restored. Previous database saved as ${safetyName}`);
  console.log('[restore] Start the server again and verify the dashboard and queue.');
} catch (err) {
  if (tempCreated) fs.rmSync(tempPath, { force: true });
  console.error('[restore] Restore failed. Check the current database and the safety backup before restarting the server.');
  throw err;
}
