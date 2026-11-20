import fs from 'node:fs';
import path from 'node:path';

/**
 * Accept current generic QueueSystem backups and legacy Infinity Services
 * backups while rejecting path traversal and unexpected file extensions.
 */
export function isSupportedBackupFilename(filename: string): boolean {
  return path.basename(filename) === filename &&
    /^(?:queuesystem|infinity)-backup-[\dTZ-]+\.db$/.test(filename);
}

/**
 * Resolve a backup only when it is a regular, non-symlink file directly inside
 * the configured backup directory. Lexical path checks alone do not stop a
 * symlink inside that directory from targeting a file elsewhere.
 */
export function resolveSafeBackupPath(backupDirectory: string, filename: string): string | null {
  if (!isSupportedBackupFilename(filename)) return null;

  try {
    const realDirectory = fs.realpathSync(backupDirectory);
    const candidate = path.join(realDirectory, filename);
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink() || !stats.isFile()) return null;

    const realCandidate = fs.realpathSync(candidate);
    if (path.dirname(realCandidate) !== realDirectory) return null;
    return realCandidate;
  } catch {
    return null;
  }
}
