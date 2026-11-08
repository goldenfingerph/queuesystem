import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { runMigrations } from './migrations.js';
import fs from 'node:fs';
import path from 'node:path';

const KNOWN_DEFAULT_ADMIN_HASH = '$2b$10$uQaqQDxB7.NM8eXTGYxoZevoFmqBzmR89T81uUHI28BZj4Gv9BT0i';

function secureDefaultAdminPassword(db: Database.Database): void {
  const admin = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get('admin') as
    | { id: number; password_hash: string }
    | undefined;
  const configuredPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!admin || admin.password_hash !== KNOWN_DEFAULT_ADMIN_HASH) {
    delete process.env.ADMIN_INITIAL_PASSWORD;
    return;
  }
  const oneTimePassword = typeof configuredPassword === 'string' && configuredPassword.length >= 12
    ? configuredPassword
    : crypto.randomBytes(18).toString('base64url');
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(oneTimePassword), admin.id);
  if (configuredPassword && configuredPassword.length >= 12) {
    console.log('[db] Admin password initialized from ADMIN_INITIAL_PASSWORD. Change it after login.');
  } else {
    console.log('\n=================================================');
    console.log('  FIRST-RUN ADMIN PASSWORD (shown only once)');
    console.log(`  Username: admin`);
    console.log(`  Password: ${oneTimePassword}`);
    console.log('  Save this password now, then change it after login.');
    console.log('=================================================\n');
  }
  // The bootstrap value is a one-time input; do not retain it in process memory.
  delete process.env.ADMIN_INITIAL_PASSWORD;
}

export type DB = Database.Database;

let instance: DB | null = null;

export function getDb(): DB {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  secureDefaultAdminPassword(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
