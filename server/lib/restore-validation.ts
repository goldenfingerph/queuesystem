import type Database from 'better-sqlite3';

export function validateBackup(db: Database.Database): void {
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
    throw new Error(`Not a complete QueueSystem database; missing tables: ${missingTables.join(', ')}`);
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
