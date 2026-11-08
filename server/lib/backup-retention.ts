import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

const BACKUP_FILENAME_PATTERN = /^infinity-backup-[\\dTZ-]+\\.db$/;
export const DEFAULT_BACKUP_RETENTION_COUNT = 30;

interface BackupRow {
  id: number;
  filename: string;
  created_at: string;
}

export interface BackupRotationResult {
  retained: number;
  removed: number;
  failed: string[];
}

/**
 * Prune only regular backups created by the backup endpoint.
 * Restore safety copies and unrelated files are intentionally out of scope.
 */
export function rotateBackups(
  db: Database.Database,
  backupsDir: string,
  retentionCount = DEFAULT_BACKUP_RETENTION_COUNT,
): BackupRotationResult {
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) {
    throw new RangeError('Backup retention count must be a positive safe integer');
  }

  const directory = path.resolve(backupsDir);
  const rows = db.prepare(
    'SELECT id, filename, created_at FROM backups ORDER BY created_at DESC, id DESC',
  ).all() as BackupRow[];

  const managedRows = rows
    .filter((row) => path.basename(row.filename) === row.filename && BACKUP_FILENAME_PATTERN.test(row.filename))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.filename.localeCompare(a.filename) || b.id - a.id);

  const result: BackupRotationResult = {
    retained: Math.min(managedRows.length, retentionCount),
    removed: 0,
    failed: [],
  };

  for (const row of managedRows.slice(retentionCount)) {
    const filePath = path.resolve(directory, row.filename);
    if (!filePath.startsWith(directory + path.sep)) {
      result.failed.push(row.filename);
      continue;
    }

    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.lstatSync(filePath);
        // Never follow or remove symlinks, directories, or other special files.
        if (!stat.isFile() || stat.isSymbolicLink()) {
          result.failed.push(row.filename);
          continue;
        }
        fs.unlinkSync(filePath);
      }

      // Delete the metadata only after the file is gone (or was already missing).
      db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
      result.removed += 1;
    } catch {
      // A cleanup failure must not turn a successfully-created backup into a failed request.
      result.failed.push(row.filename);
    }
  }

  return result;
}
