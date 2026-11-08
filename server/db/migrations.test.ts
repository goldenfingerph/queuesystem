import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';

test('fresh SQLite databases receive the complete migration set', () => {
  const db = new Database(':memory:');

  try {
    runMigrations(db);

    const applied = db.prepare(
      'SELECT filename FROM schema_migrations ORDER BY filename',
    ).all() as { filename: string }[];

    assert.deepEqual(applied.map((row) => row.filename), [
      '001_initial_schema.sql',
      '002_auth_priority.sql',
      '003_admin_password.sql',
      '004_transfer_target_counter.sql',
      '005_daily_ticket_ranges.sql',
      '006_assignment_guards.sql',
      '007_service_arabic_name.sql',
      '008_transfer_priority.sql',
    ]);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as { name: string }[];
    const tableNames = new Set(tables.map((table) => table.name));

    assert.ok(tableNames.has('users'));
    assert.ok(tableNames.has('services'));
    assert.ok(tableNames.has('tickets'));
    assert.ok(tableNames.has('counters'));
  } finally {
    db.close();
  }
});

test('running migrations again is idempotent', () => {
  const db = new Database(':memory:');

  try {
    runMigrations(db);
    const firstCount = db.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ).get() as { count: number };

    runMigrations(db);
    const secondCount = db.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ).get() as { count: number };

    assert.equal(secondCount.count, firstCount.count);
    assert.equal(secondCount.count, 8);
  } finally {
    db.close();
  }
});
