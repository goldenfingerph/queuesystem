import path from 'node:path';

/**
 * Accept current generic QueueSystem backups and legacy Infinity Services
 * backups while rejecting path traversal and unexpected file extensions.
 */
export function isSupportedBackupFilename(filename: string): boolean {
  return path.basename(filename) === filename &&
    /^(?:queuesystem|infinity)-backup-[\dTZ-]+\.db$/.test(filename);
}
