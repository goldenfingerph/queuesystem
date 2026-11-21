import fs from 'node:fs';

export interface RestoreSwapOperations {
  renameFile(from: string, to: string): void;
  removeFile(filePath: string): void;
  exists(filePath: string): boolean;
}

/**
 * Install a validated restore candidate and retain the original database until
 * validation at the final path succeeds. Any failure after moving the original
 * attempts to put that original database back. The rollback file is never
 * deleted by this function.
 */
export function replaceDatabaseWithRollback(
  databasePath: string,
  candidatePath: string,
  rollbackPath: string,
  validateInstalled: () => void,
  operations: RestoreSwapOperations = {
    renameFile: (from, to) => fs.renameSync(from, to),
    removeFile: (filePath) => fs.rmSync(filePath),
    exists: (filePath) => fs.existsSync(filePath),
  },
): void {
  if (operations.exists(rollbackPath)) {
    throw new Error('A previous restore rollback file already exists; move it aside before retrying.');
  }

  operations.renameFile(databasePath, rollbackPath);
  let candidateInstalled = false;

  try {
    operations.renameFile(candidatePath, databasePath);
    candidateInstalled = true;
    validateInstalled();
  } catch (restoreError) {
    try {
      if (candidateInstalled && operations.exists(databasePath)) {
        operations.removeFile(databasePath);
      }
      if (operations.exists(rollbackPath)) {
        operations.renameFile(rollbackPath, databasePath);
      }
    } catch (rollbackError) {
      throw new Error(
        `Restore failed and automatic rollback failed. Preserve the rollback file at ${rollbackPath}. Restore error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    throw restoreError;
  }
}
