import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

interface BackupRecord {
  id: number;
  filename: string;
}

/**
 * Keep the newest regular database backups and remove only files created by
 * the backup endpoint. Restore safety copies use a different prefix and are
 * deliberately excluded from automatic rotation.
 */
export function rotateBackups(
  db: Database.Database,
  backupsDir: string,
  keepCount = 30,
): number {
  if (!Number.isSafeInteger(keepCount) || keepCount < 1 || keepCount > 1000) {
    throw new Error('Backup retention count must be an integer from 1 to 1000.');
  }

  const records = db.prepare(
    "SELECT id, filename FROM backups WHERE filename GLOB 'infinity-backup-*.db' ORDER BY created_at DESC, id DESC",
  ).all() as BackupRecord[];
  let removed = 0;

  for (const record of records.slice(keepCount)) {
    if (path.basename(record.filename) !== record.filename ||
        !/^infinity-backup-[\dTZ-]+\.db$/.test(record.filename)) {
      continue;
    }

    const filePath = path.resolve(backupsDir, record.filename);
    if (!filePath.startsWith(path.resolve(backupsDir) + path.sep)) continue;

    try {
      if (fs.existsSync(filePath)) {
        if (!fs.statSync(filePath).isFile()) continue;
        fs.rmSync(filePath);
      }
      db.prepare('DELETE FROM backups WHERE id = ?').run(record.id);
      removed += 1;
    } catch (error) {
      // Keep the metadata row when the file could not be removed so a later
      // rotation can retry instead of silently losing track of the backup.
      console.warn('[backup] unable to rotate old backup:', record.filename, error);
    }
  }

  return removed;
}
