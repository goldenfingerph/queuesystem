import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isSupportedBackupFilename, resolveSafeBackupPath } from '../lib/backup-validation.js';
import { validateBackup } from '../lib/restore-validation.js';
import { replaceDatabaseWithRollback } from '../lib/restore-file-swap.js';

function fail(message: string): never {
  console.error(`[restore] ${message}`);
  process.exit(1);
}



const filename = process.argv[2];
if (!filename || !isSupportedBackupFilename(filename)) {
  fail('Usage: npm run db:restore -- queuesystem-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db (legacy infinity-backup files are also supported)');
}
const backupPath = resolveSafeBackupPath(config.backupsDir, filename);
const dbPath = path.resolve(config.dbPath);
if (!backupPath) {
  fail('Backup file must be a regular, non-symlink file inside the configured local backups folder.');
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
  // Checkpoint before closing so the rollback database is self-contained.
  live.pragma('wal_checkpoint(TRUNCATE)');
  await live.backup(safetyPath);
} finally {
  live.close();
}
// The live database was checkpointed before closing. Remove its now-stale
// SQLite sidecars so they cannot be attached to the restored database.
for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });

const tempPath = `${dbPath}.restore-tmp`;
const rollbackPath = `${dbPath}.pre-restore`;
let tempCreated = false;
try {
  // Re-resolve immediately before copying to reduce the chance of a path
  // being swapped after the initial validation.
  const currentBackupPath = resolveSafeBackupPath(config.backupsDir, filename);
  if (!currentBackupPath || currentBackupPath !== backupPath) {
    throw new Error('Backup path changed after validation; no database changes were made.');
  }

  fs.copyFileSync(currentBackupPath, tempPath, fs.constants.COPYFILE_EXCL);
  tempCreated = true;
  const check = new Database(tempPath, { readonly: true, fileMustExist: true });
  try {
    validateBackup(check);
  } finally {
    check.close();
  }

  // Keep the original database until the restored file passes validation
  // after installation at its final path. The helper restores the original
  // automatically if the replacement or final validation fails.
  replaceDatabaseWithRollback(dbPath, tempPath, rollbackPath, () => {
    const installed = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      validateBackup(installed);
    } finally {
      installed.close();
    }
  });
  tempCreated = false;

  // The previous database remains available as rollback until validation has
  // passed. A cleanup failure is non-fatal; preserve the rollback for review.
  try {
    fs.rmSync(rollbackPath);
  } catch (cleanupError) {
    console.warn('[restore] Restore succeeded, but the rollback file could not be removed:', cleanupError);
    console.warn(`[restore] Keep ${rollbackPath} until it can be safely reviewed.`);
  }

  console.log(`[restore] Database restored. Previous database safety copy saved as ${safetyName}`);
  console.log('[restore] Start the server again and verify the dashboard and queue.');
} catch (err) {
  // The swap helper already attempted rollback. Never remove the rollback
  // file here: it may be the only remaining copy of the original database.
  if (fs.existsSync(rollbackPath)) {
    console.error('[restore] Preserve the rollback file for recovery:', rollbackPath);
  }
  if (tempCreated) fs.rmSync(tempPath, { force: true });
  console.error('[restore] Restore failed. Check the current database and the safety backup before restarting the server.');
  throw err;
}
