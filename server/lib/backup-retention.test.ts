import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import { rotateBackups } from './backup-retention.js';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-retention-'));
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE backups (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare('INSERT INTO backups (filename, created_at) VALUES (?, ?)');
  return {
    directory,
    db,
    addBackup(filename: string, createdAt: string, createFile = true) {
      const result = insert.run(filename, createdAt);
      if (createFile) fs.writeFileSync(path.join(directory, filename), 'sqlite backup');
      return Number(result.lastInsertRowid);
    },
    close() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('retains newest regular backups and leaves restore safety copies untouched', () => {
  const state = setup();
  try {
    state.addBackup('infinity-backup-2026-01-01T00-00-00-000Z.db', '2026-01-01 00:00:00');
    state.addBackup('infinity-backup-2026-01-02T00-00-00-000Z.db', '2026-01-02 00:00:00');
    state.addBackup('infinity-backup-2026-01-03T00-00-00-000Z.db', '2026-01-03 00:00:00');
    state.addBackup('infinity-backup-2026-01-04T00-00-00-000Z.db', '2026-01-04 00:00:00');
    state.addBackup('infinity-pre-restore-2026-01-01T00-00-00-000Z.db', '2026-01-01 00:00:00');

    const safetyFile = 'infinity-pre-restore-2026-01-01T00-00-00-000Z.db';
    fs.writeFileSync(path.join(state.directory, safetyFile), 'safety copy');

    const result = rotateBackups(state.db, state.directory, 2);

    assert.equal(result.retained, 2);
    assert.equal(result.removed, 2);
    assert.deepEqual(result.failed, []);
    assert.equal(fs.existsSync(path.join(state.directory, 'infinity-backup-2026-01-01T00-00-00-000Z.db')), false);
    assert.equal(fs.existsSync(path.join(state.directory, 'infinity-backup-2026-01-02T00-00-00-000Z.db')), false);
    assert.equal(fs.existsSync(path.join(state.directory, 'infinity-backup-2026-01-03T00-00-00-000Z.db')), true);
    assert.equal(fs.existsSync(path.join(state.directory, 'infinity-backup-2026-01-04T00-00-00-000Z.db')), true);
    assert.equal(fs.existsSync(path.join(state.directory, safetyFile)), true);

    const remaining = state.db.prepare('SELECT filename FROM backups ORDER BY filename').all() as { filename: string }[];
    assert.deepEqual(remaining.map((row) => row.filename), [
      'infinity-backup-2026-01-03T00-00-00-000Z.db',
      'infinity-backup-2026-01-04T00-00-00-000Z.db',
      safetyFile,
    ]);
  } finally {
    state.close();
  }
});

test('removes stale metadata without reducing the number of retained files', () => {
  const state = setup();
  try {
    state.addBackup('infinity-backup-2026-01-01T00-00-00-000Z.db', '2026-01-01 00:00:00', false);
    state.addBackup('infinity-backup-2026-01-02T00-00-00-000Z.db', '2026-01-02 00:00:00');
    state.addBackup('infinity-backup-2026-01-03T00-00-00-000Z.db', '2026-01-03 00:00:00');

    const result = rotateBackups(state.db, state.directory, 2);

    assert.equal(result.retained, 2);
    assert.equal(result.removed, 1);
    assert.deepEqual(result.failed, []);
    const remaining = state.db.prepare('SELECT filename FROM backups').all() as { filename: string }[];
    assert.equal(remaining.length, 2);
  } finally {
    state.close();
  }
});

test('rejects a zero or invalid retention count', () => {
  const state = setup();
  try {
    assert.throws(() => rotateBackups(state.db, state.directory, 0), RangeError);
    assert.throws(() => rotateBackups(state.db, state.directory, 1.5), RangeError);
  } finally {
    state.close();
  }
});
