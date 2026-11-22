import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import Database from 'better-sqlite3';
import { isAllowedWebSocketOrigin } from '../ws/index.js';
import { hasSupportedFileSignature } from '../lib/upload-validation.js';
import { rotateBackups } from '../lib/backup-retention.js';
import { pruneQueueEvents } from '../lib/queue-event-retention.js';
import { getBusinessDate } from '../../shared/business-date.js';
import { isSupportedBackupFilename, resolveSafeBackupPath } from '../lib/backup-validation.js';
import { validateBackup } from '../lib/restore-validation.js';
import { replaceDatabaseWithRollback } from '../lib/restore-file-swap.js';
import { createReportPdf, createReportXlsx, shapeArabicForPdf } from '../lib/report-export.js';

function readStoredZipEntry(archive: Buffer, requestedName: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = archive.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
    const dataStart = nameStart + fileNameLength + extraLength;
    if (name === requestedName) {
      assert.equal(compressionMethod, 0, 'XLSX test archive entries should use stored ZIP records');
      return archive.subarray(dataStart, dataStart + compressedSize);
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

test('PDF and XLSX exports handle Arabic text, invalid XML controls, and multi-page layouts', async () => {
  const workbook = createReportXlsx(
    ['Ticket & Number', 'Arabic Service'],
    [['T-1001', 'خدمة المصدر\u0001 <Main> & Co']],
    'QueueSystem Report',
    'Daily export',
  );
  const worksheet = readStoredZipEntry(workbook, 'xl/worksheets/sheet1.xml');
  assert.ok(worksheet, 'XLSX must include its worksheet');
  const worksheetXml = worksheet.toString('utf8');
  assert.match(worksheetXml, /Ticket &amp; Number/);
  assert.match(worksheetXml, /خدمة المصدر &lt;Main&gt; &amp; Co/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(worksheetXml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);

  const shapedArabic = shapeArabicForPdf('رقم التذكرة ١٢٣');
  assert.notEqual(shapedArabic, 'رقم التذكرة ١٢٣', 'Arabic letters must be contextually shaped and reordered');
  assert.match(shapedArabic, /١٢٣/, 'Arabic-Indic digits must remain in reading order');
  assert.match(shapedArabic, /[\uFB50-\uFEFF]/u, 'Arabic letters must use presentation forms');

  const headers = Array.from({ length: 12 }, (_, index) => `Column ${index + 1}`);
  const rows = Array.from({ length: 23 }, (_, row) => headers.map((_, column) => `R${row + 1}C${column + 1}`));
  rows[0][1] = 'خدمة العملاء';
  rows[0][6] = 'الفئة الرئيسية';
  const pdf = (await createReportPdf(headers, rows, 'QueueSystem Report', 'Pagination check')).toString('latin1');
  assert.match(pdf, /\/Count 6/, '22-row pagination and three 5-column panels must be retained');
  assert.match(pdf, /\/FontFile2/, 'PDF must embed the Arabic-capable font');
  assert.match(pdf, /\/ToUnicode/, 'PDF must include Unicode mappings for copy/search support');
});

test('restore accepts generic and legacy backup names while rejecting unsafe paths', () => {
  assert.equal(isSupportedBackupFilename('queuesystem-backup-2026-11-16T10-20-30-000Z.db'), true);
  assert.equal(isSupportedBackupFilename('infinity-backup-2026-11-16T10-20-30-000Z.db'), true);
  assert.equal(isSupportedBackupFilename('../queuesystem-backup-2026-11-16T10-20-30-000Z.db'), false);
  assert.equal(isSupportedBackupFilename('queuesystem-pre-restore-2026-11-16T10-20-30-000Z.db'), false);
  assert.equal(isSupportedBackupFilename('queuesystem-backup-latest.db'), false);
  assert.equal(isSupportedBackupFilename('queuesystem-backup-2026-11-16T10-20-30-000Z.sqlite'), false);
});





test('restore path resolution rejects missing files and symlink escapes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-restore-path-'));
  const backups = path.join(root, 'backups');
  const outside = path.join(root, 'outside.db');
  fs.mkdirSync(backups);
  try {
    const validName = 'queuesystem-backup-2026-11-16T10-20-30-000Z.db';
    const validPath = path.join(backups, validName);
    fs.writeFileSync(validPath, 'backup');
    fs.writeFileSync(outside, 'outside');

    assert.equal(resolveSafeBackupPath(backups, validName), fs.realpathSync(validPath));
    assert.equal(resolveSafeBackupPath(backups, 'queuesystem-backup-missing.db'), null);
    assert.equal(resolveSafeBackupPath(backups, '../outside.db'), null);

    const linkPath = path.join(backups, 'queuesystem-backup-2026-11-17T10-20-30-000Z.db');
    try {
      fs.symlinkSync(outside, linkPath, 'file');
    } catch (error) {
      t.skip(`Symlink creation is unavailable on this runner: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    assert.equal(resolveSafeBackupPath(backups, path.basename(linkPath)), null,
      'a backup symlink must not allow restoring a file outside the backup directory');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('restore validation rejects corrupt and incomplete backups before live database changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-restore-validation-'));
  const livePath = path.join(directory, 'live.db');
  const validPath = path.join(directory, 'valid.db');
  const missingTablePath = path.join(directory, 'missing-table.db');
  const missingMigrationPath = path.join(directory, 'missing-migration.db');
  const corruptPath = path.join(directory, 'corrupt.db');
  const requiredTables = [
    'users', 'services', 'counters', 'counter_services', 'staff_assignments',
    'tickets', 'queue_events', 'system_settings', 'ads', 'backups',
    'sessions', 'visitor_categories', 'ticket_sequences', 'schema_migrations',
  ];
  const createSchema = (database: Database.Database, omitTable?: string) => {
    for (const table of requiredTables) {
      if (table === omitTable) continue;
      if (table === 'schema_migrations') {
        database.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY)');
      } else {
        database.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`);
      }
    }
  };
  try {
    // Use an opaque sentinel file for the live database boundary. The test is
    // proving rejected candidates do not mutate it; opening SQLite here adds
    // Windows file-handle locking noise unrelated to restore validation.
    const originalLiveBytes = Buffer.from('original-live-database');
    fs.writeFileSync(livePath, originalLiveBytes);

    const valid = new Database(validPath);
    createSchema(valid);
    valid.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run('001_initial_schema.sql');
    valid.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run('002_auth_priority.sql');
    assert.doesNotThrow(() => validateBackup(valid));
    valid.close();

    const missingTable = new Database(missingTablePath);
    try {
      createSchema(missingTable, 'tickets');
      missingTable.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run('001_initial_schema.sql');
      missingTable.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run('002_auth_priority.sql');
      assert.throws(() => validateBackup(missingTable), /missing tables: tickets/);
    } finally {
      missingTable.close();
    }

    const missingMigration = new Database(missingMigrationPath);
    try {
      createSchema(missingMigration);
      missingMigration.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run('001_initial_schema.sql');
      assert.throws(() => validateBackup(missingMigration), /002_auth_priority\.sql/);
    } finally {
      missingMigration.close();
    }

    fs.writeFileSync(corruptPath, 'this is not a SQLite database');
    assert.throws(() => {
      const corrupt = new Database(corruptPath, { readonly: true, fileMustExist: true });
      try {
        validateBackup(corrupt);
      } finally {
        corrupt.close();
      }
    }, /SQLite|database|file/i);

    // Mirror the restore script's preflight boundary: candidate validation
    // completes before the live database is opened for backup or replacement.
    assert.throws(() => {
      const candidate = new Database(missingTablePath, { readonly: true, fileMustExist: true });
      try {
        validateBackup(candidate);
      } finally {
        candidate.close();
      }
    }, /missing tables/);
    assert.deepEqual(
      fs.readFileSync(livePath),
      originalLiveBytes,
      'a rejected candidate must leave the live database file unchanged',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('queue event retention prunes only aged terminal-ticket history and keeps each final event', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE tickets (id INTEGER PRIMARY KEY, status TEXT NOT NULL, business_date TEXT NOT NULL);
      CREATE TABLE queue_events (
        id INTEGER PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO tickets (id, status, business_date) VALUES (?, ?, ?)').run(1, 'completed', '2024-01-01');
    db.prepare('INSERT INTO tickets (id, status, business_date) VALUES (?, ?, ?)').run(2, 'waiting', '2024-01-01');
    db.prepare('INSERT INTO tickets (id, status, business_date) VALUES (?, ?, ?)').run(3, 'completed', '2026-10-01');
    const event = db.prepare('INSERT INTO queue_events (ticket_id, event_type, created_at) VALUES (?, ?, ?)');
    event.run(1, 'created', '2024-01-01 08:00:00');
    event.run(1, 'called', '2024-01-01 08:05:00');
    event.run(1, 'completed', '2024-01-01 08:10:00');
    event.run(2, 'created', '2024-01-01 08:00:00');
    event.run(2, 'called', '2024-01-01 08:05:00');
    event.run(3, 'created', '2026-10-01 08:00:00');
    event.run(3, 'completed', '2026-10-01 08:10:00');

    assert.equal(pruneQueueEvents(db, 365, new Date('2026-11-08T12:00:00.000Z')), 2);
    const remaining = db.prepare('SELECT ticket_id, event_type FROM queue_events ORDER BY id').all() as {
      ticket_id: number; event_type: string;
    }[];
    assert.deepEqual(remaining, [
      { ticket_id: 1, event_type: 'completed' },
      { ticket_id: 2, event_type: 'created' },
      { ticket_id: 2, event_type: 'called' },
      { ticket_id: 3, event_type: 'created' },
      { ticket_id: 3, event_type: 'completed' },
    ]);
    assert.throws(() => pruneQueueEvents(db, 29), /30 to 3650/);
    assert.throws(() => pruneQueueEvents(db, 365, new Date(Number.NaN)), /valid current date/);
  } finally {
    db.close();
  }
});

test('backup rotation keeps newest regular backups and preserves restore safety copies', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-backup-retention-'));
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE backups (
        id INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO backups (filename, created_at) VALUES (?, ?)');
    for (let index = 1; index <= 4; index += 1) {
      const filename = `infinity-backup-2026-11-0${index}T00-00-00-000Z.db`;
      fs.writeFileSync(path.join(directory, filename), `backup-${index}`);
      insert.run(filename, `2026-11-0${index} 00:00:00`);
    }
    const safetyCopy = 'infinity-pre-restore-2026-11-08T00-00-00-000Z.db';
    fs.writeFileSync(path.join(directory, safetyCopy), 'safety-copy');
    insert.run(safetyCopy, '2026-11-08 00:00:00');

    assert.equal(rotateBackups(db, directory, 2), 2);
    const remaining = db.prepare('SELECT filename FROM backups ORDER BY filename').all() as { filename: string }[];
    assert.deepEqual(remaining.map((row) => row.filename).sort(), [
      'infinity-backup-2026-11-03T00-00-00-000Z.db',
      'infinity-backup-2026-11-04T00-00-00-000Z.db',
      safetyCopy,
    ].sort());
    assert.equal(fs.existsSync(path.join(directory, 'infinity-backup-2026-11-01T00-00-00-000Z.db')), false);
    assert.equal(fs.existsSync(path.join(directory, 'infinity-backup-2026-11-02T00-00-00-000Z.db')), false);
    assert.equal(fs.existsSync(path.join(directory, safetyCopy)), true);
    assert.throws(() => rotateBackups(db, directory, 0), /retention count/);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('backup rotation never follows or deletes a symlink target', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-backup-symlink-retention-'));
  const outsidePath = path.join(directory, 'outside.db');
  const linkName = 'queuesystem-backup-2026-11-01T00-00-00-000Z.db';
  const linkPath = path.join(directory, linkName);
  const db = new Database(':memory:');
  try {
    fs.writeFileSync(outsidePath, 'outside-sensitive-data');
    try {
      fs.symlinkSync(outsidePath, linkPath, 'file');
    } catch (error) {
      t.skip(`Symlink creation is unavailable on this runner: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    db.exec(`
      CREATE TABLE backups (
        id INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO backups (filename, created_at) VALUES (?, ?)');
    insert.run(linkName, '2026-11-01 00:00:00');
    const newestName = 'queuesystem-backup-2026-11-02T00-00-00-000Z.db';
    fs.writeFileSync(path.join(directory, newestName), 'newest-backup');
    insert.run(newestName, '2026-11-02 00:00:00');

    assert.equal(rotateBackups(db, directory, 1), 0,
      'rotation must skip a symlink instead of deleting its target or metadata');
    assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'outside-sensitive-data');
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM backups WHERE filename = ?').get(linkName) as { count: number }).count,
      1,
      'metadata for a skipped symlink must remain for safe manual review',
    );
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('business date supports company timezones and configurable rollover while preserving UAE defaults', () => {
  assert.equal(getBusinessDate(new Date('2026-11-08T01:59:59.000Z')), '2026-11-07', 'UAE default: before 06:00 remains previous day');
  assert.equal(getBusinessDate(new Date('2026-11-08T02:00:00.000Z')), '2026-11-08', 'UAE default: 06:00 starts new day');
  assert.equal(getBusinessDate(new Date('2024-03-01T01:59:59.000Z')), '2024-02-29', 'default handles leap-day rollover');
  assert.equal(getBusinessDate(new Date('2026-11-08T04:59:00.000Z'), { timeZone: 'America/New_York', dayStart: '00:00' }), '2026-11-07', 'New York midnight is evaluated in company timezone');
  assert.equal(getBusinessDate(new Date('2026-11-08T05:00:00.000Z'), { timeZone: 'America/New_York', dayStart: '00:00' }), '2026-11-08', 'New York business day rolls over at local midnight');
  assert.equal(getBusinessDate(new Date('2026-11-08T05:29:00.000Z'), { timeZone: 'Asia/Dubai', dayStart: '09:30' }), '2026-11-07', 'custom business start is respected');
  assert.equal(getBusinessDate(new Date('2026-11-08T05:30:00.000Z'), { timeZone: 'Asia/Dubai', dayStart: '09:30' }), '2026-11-08', 'custom business start boundary is inclusive');
  assert.throws(() => getBusinessDate(new Date(Number.NaN)), /valid date/);
  assert.throws(() => getBusinessDate(new Date(), { timeZone: 'Not/A_Timezone' }), /IANA timezone/);
  assert.throws(() => getBusinessDate(new Date(), { dayStart: '24:00' }), /HH:mm/);
});

test('WebSocket origin policy only accepts the matching transport origin and host', () => {
  assert.equal(isAllowedWebSocketOrigin('http://queue.local:4000', 'queue.local:4000', false), true);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000', 'queue.local:4000', true), true);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000', 'queue.local:4000', false), false);
  assert.equal(isAllowedWebSocketOrigin('http://queue.local:4000', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin('https://attacker.example', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin(undefined, 'queue.local:4000', false), false);
  assert.equal(isAllowedWebSocketOrigin('not-an-origin', 'queue.local:4000', false), false);
});

test('assigned service officer can transfer a waiting ticket pinned to their counter', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-backend-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  process.env.ADS_DIR = path.join(directory, 'uploads', 'ads');
  process.env.LOGO_DIR = path.join(directory, 'uploads', 'logo');
  process.env.BACKUPS_DIR = path.join(directory, 'backups');

  let server: http.Server | undefined;
  let closeDb: (() => void) | undefined;

  try {
    const [{ createApp }, database, middleware, auth, serverConfig] = await Promise.all([
      import('../app.js'),
      import('../db/index.js'),
      import('../lib/middleware.js'),
      import('../lib/auth.js'),
      import('../config.js'),
    ]);
    closeDb = database.closeDb;
    assert.doesNotThrow(() => serverConfig.validateServerEnvironment({}));
    assert.throws(() => serverConfig.validateServerEnvironment({ PORT: '0' }), /PORT must be a whole number/);
    assert.throws(() => serverConfig.validateServerEnvironment({ HOST: 'bad host' }), /HOST must be a valid/);
    assert.throws(() => serverConfig.validateServerEnvironment({ TLS_CERT_FILE: 'server.crt' }), /TLS_CERT_FILE and TLS_KEY_FILE/);
    const tlsDirectory = path.join(directory, 'tls');
    fs.mkdirSync(tlsDirectory);
    const tlsCertPath = path.join(tlsDirectory, 'server.crt');
    const tlsKeyPath = path.join(tlsDirectory, 'server.key');
    fs.writeFileSync(tlsCertPath, 'test certificate');
    fs.writeFileSync(tlsKeyPath, 'test private key');
    assert.doesNotThrow(() => serverConfig.validateServerEnvironment({
      TLS_CERT_FILE: tlsCertPath,
      TLS_KEY_FILE: tlsKeyPath,
    }), 'a readable certificate/key file pair must pass path validation');
    assert.throws(() => serverConfig.validateServerEnvironment({
      TLS_CERT_FILE: tlsDirectory,
      TLS_KEY_FILE: tlsKeyPath,
    }), /TLS_CERT_FILE must point to a readable regular file/,
    'TLS configuration must reject directories instead of failing later during server startup');
    assert.throws(() => serverConfig.validateServerEnvironment({
      TLS_CERT_FILE: path.join(tlsDirectory, 'missing.crt'),
      TLS_KEY_FILE: tlsKeyPath,
    }), /TLS_CERT_FILE points to a file that does not exist or cannot be read/);
    assert.throws(() => serverConfig.validateServerEnvironment({ ADMIN_INITIAL_PASSWORD: 'short' }), /ADMIN_INITIAL_PASSWORD must be 12 to 200/);
    assert.throws(() => serverConfig.validateServerEnvironment({ QUEUE_EVENT_RETENTION_DAYS: '10' }), /QUEUE_EVENT_RETENTION_DAYS must be a whole number from 30 to 3650/);
    const firstRunPassword = 'test-first-run-admin-password';
    process.env.ADMIN_INITIAL_PASSWORD = firstRunPassword;
    const db = database.getDb();
    assert.equal(process.env.ADMIN_INITIAL_PASSWORD, undefined, 'bootstrap password must be cleared after initialization');

    const userResult = db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, 'service_officer', 1)",
    ).run('counter-officer', 'test-hash', 'Counter Officer');
    const userId = Number(userResult.lastInsertRowid);

    const sourceCounter = Number(db.prepare(
      "INSERT INTO counters (number, name, is_active) VALUES (1, 'Source', 1)",
    ).run().lastInsertRowid);
    const targetCounter = Number(db.prepare(
      "INSERT INTO counters (number, name, is_active) VALUES (2, 'Target', 1)",
    ).run().lastInsertRowid);

    const sourceService = Number(db.prepare(
      "INSERT INTO services (name, name_ar, code, prefix, ticket_range_start, ticket_range_end) VALUES ('Source service', 'خدمة المصدر', 'SRC', 'S', 1000, 1499)",
    ).run().lastInsertRowid);
    const targetService = Number(db.prepare(
      "INSERT INTO services (name, name_ar, code, prefix, ticket_range_start, ticket_range_end) VALUES ('Target service', 'الخدمة الهدف', 'TGT', 'T', 1500, 1999)",
    ).run().lastInsertRowid);

    db.prepare('INSERT INTO counter_services (counter_id, service_id) VALUES (?, ?)').run(sourceCounter, sourceService);
    db.prepare('INSERT INTO counter_services (counter_id, service_id) VALUES (?, ?)').run(targetCounter, targetService);
    db.prepare(
      "INSERT INTO staff_assignments (user_id, counter_id, status) VALUES (?, ?, 'active')",
    ).run(userId, sourceCounter);

    const ticketResult = db.prepare(
      "INSERT INTO tickets (number, service_id, status, priority, queued_for_counter_id, business_date, created_at) VALUES ('1001', ?, 'waiting', 'normal', ?, '2026-11-08', '2026-11-08 10:00:00')",
    ).run(sourceService, sourceCounter);
    const ticketId = Number(ticketResult.lastInsertRowid);
    db.prepare(
      "INSERT INTO tickets (number, service_id, status, priority, business_date, created_at) VALUES (?, ?, 'completed', 'normal', ?, ?)",
    ).run('9001', sourceService, '2026-11-08', '2026-11-08 09:00:00');
    db.prepare(
      "INSERT INTO tickets (number, service_id, status, priority, business_date, created_at) VALUES (?, ?, 'completed', 'normal', ?, ?)",
    ).run('9002', sourceService, '2026-11-08', '2026-11-08 08:00:00');
    db.prepare(
      "INSERT INTO queue_events (ticket_id, event_type, from_status, to_status) VALUES (?, 'created', NULL, 'waiting')",
    ).run(ticketId);

    const token = middleware.createSession(userId);
    const storedSession = db.prepare('SELECT token FROM sessions WHERE user_id = ?').get(userId) as { token: string };
    assert.equal(storedSession.token, auth.hashToken(token), 'SQLite must store only the token digest');
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const [manifestResponse, workerResponse, iconResponse, pageResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${address.port}/manifest.webmanifest`),
      fetch(`http://127.0.0.1:${address.port}/sw.js`),
      fetch(`http://127.0.0.1:${address.port}/pwa-icon.svg`),
      fetch(`http://127.0.0.1:${address.port}/`),
    ]);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json() as { start_url: string; display: string; icons: Array<{ src: string }> };
    assert.equal(manifest.start_url, '/#/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.icons[0]?.src, '/pwa-icon.svg');
    assert.equal(workerResponse.status, 200);
    const worker = await workerResponse.text();
    assert.ok(worker.includes("url.pathname.startsWith('/api/')"));
    assert.ok(worker.includes("request.mode === 'navigate'"));
    assert.equal(iconResponse.status, 200);
    assert.match(await iconResponse.text(), /<svg/);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /rel="manifest"/);
    // Private queue and reporting APIs must reject anonymous access, while the
    // public service catalogue and TV projection remain intentionally readable.
    for (const endpoint of ['/api/tickets', '/api/counters', '/api/reports', '/api/staff']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${endpoint}`);
      assert.equal(response.status, 401, `${endpoint} must require authentication`);
    }
    const anonymousTicketCreate = await fetch(`http://127.0.0.1:${address.port}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service_id: sourceService }),
    });
    assert.equal(anonymousTicketCreate.status, 401, 'ticket creation must require a receptionist/staff session');
    const publicServices = await fetch(`http://127.0.0.1:${address.port}/api/services`);
    assert.equal(publicServices.status, 200, 'the reception service catalogue must remain public');
    const publicTvQueue = await fetch(`http://127.0.0.1:${address.port}/api/tv/queue`);
    assert.equal(publicTvQueue.status, 200, 'the TV queue projection must remain public');
    assert.equal(JSON.stringify(await publicTvQueue.json()).includes('visitor@example.com'), false,
      'the public TV projection must not expose visitor contact details');

    // Existing pre-upgrade raw sessions remain valid and are hashed on first use.
    const legacyToken = 'a'.repeat(64);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(legacyToken, userId, auth.sessionExpiry());
    const legacyResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { authorization: `Bearer ${legacyToken}` },
    });
    assert.equal(legacyResponse.status, 200, await legacyResponse.text());
    assert.equal(legacyResponse.headers.get('x-content-type-options'), 'nosniff', 'Helmet must prevent MIME sniffing');
    assert.equal(legacyResponse.headers.get('x-frame-options'), 'SAMEORIGIN', 'Helmet must prevent framing by other sites');
    assert.equal(legacyResponse.headers.get('cache-control'), 'no-store', 'API responses must not be cached');
    assert.equal(legacyResponse.headers.get('pragma'), 'no-cache', 'API responses must opt out of legacy caches');
    assert.equal(legacyResponse.headers.get('x-powered-by'), null, 'Express fingerprint header must be disabled');

    const firstTicketPage = await fetch(`http://127.0.0.1:${address.port}/api/tickets?page=1&limit=2`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(firstTicketPage.status, 200);
    const firstPageData = await firstTicketPage.json() as {
      tickets: { number: string }[];
      pagination: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
    };
    assert.equal(firstPageData.tickets.length, 2);
    assert.equal(firstPageData.pagination.page, 1);
    assert.equal(firstPageData.pagination.limit, 2);
    assert.equal(firstPageData.pagination.total, 3);
    assert.equal(firstPageData.pagination.totalPages, 2);
    assert.equal(firstPageData.pagination.hasNextPage, true);
    assert.equal(firstPageData.pagination.hasPreviousPage, false);
    assert.equal(firstPageData.tickets[0].number, '1001', 'newest tickets must appear first');
    assert.equal(firstPageData.tickets[1].number, '9001');

    const secondTicketPage = await fetch(`http://127.0.0.1:${address.port}/api/tickets?page=2&limit=2`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(secondTicketPage.status, 200);
    const secondPageData = await secondTicketPage.json() as {
      tickets: { number: string }[];
      pagination: { page: number; total: number; hasNextPage: boolean; hasPreviousPage: boolean };
    };
    assert.deepEqual(secondPageData.tickets.map((ticket) => ticket.number), ['9002']);
    assert.equal(secondPageData.pagination.total, 3);
    assert.equal(secondPageData.pagination.hasNextPage, false);
    assert.equal(secondPageData.pagination.hasPreviousPage, true);

    const historyResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets?fromDate=2026-11-08&toDate=2026-11-08&search=Source%20service&page=1&limit=10`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(historyResponse.status, 200, await historyResponse.clone().text());
    const historyData = await historyResponse.json() as {
      tickets: Array<{ number: string; service_name: string; service_prefix: string; category_label: string | null; counter_number: number | null }>;
      pagination: { total: number };
    };
    assert.equal(historyData.pagination.total, 3, 'history date and service-name filters must return matching tickets');
    assert.ok(historyData.tickets.every((ticket) => ticket.service_name === 'Source service'));
    assert.equal(historyData.tickets[0]?.service_prefix, 'S');
    assert.equal(historyData.tickets[0]?.category_label, null);
    assert.equal(historyData.tickets[0]?.counter_number, null);

    const historyPrefixResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets?fromDate=2026-11-08&toDate=2026-11-08&search=S&page=1&limit=10`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(historyPrefixResponse.status, 200);
    const historyPrefixData = await historyPrefixResponse.json() as { pagination: { total: number } };
    assert.equal(historyPrefixData.pagination.total, 3, 'history search must match service prefixes');

    const invalidHistoryDate = await fetch(`http://127.0.0.1:${address.port}/api/tickets?fromDate=2026-02-30`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(invalidHistoryDate.status, 400, 'invalid calendar dates must be rejected');

    const analyticsResponse = await fetch(`http://127.0.0.1:${address.port}/api/reports/analytics?from=2026-11-08&to=2026-11-08`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(analyticsResponse.status, 200, await analyticsResponse.clone().text());
    const analytics = await analyticsResponse.json() as {
      from: string; to: string; totals: { total: number; completed: number };
      daily: Array<{ date: string; total: number }>;
      byService: Array<{ serviceId: number; total: number }>;
      hourly: Array<{ hour: number; total: number }>;
    };
    assert.equal(analytics.from, '2026-11-08');
    assert.equal(analytics.to, '2026-11-08');
    assert.equal(analytics.totals.total, 3, 'analytics totals must include all tickets in the business-date range');
    assert.equal(analytics.totals.completed, 2);
    assert.deepEqual(analytics.daily, [{ date: '2026-11-08', total: 3, completed: 2, skipped: 0 }]);
    assert.equal(analytics.byService[0]?.serviceId, sourceService);
    assert.equal(analytics.byService[0]?.total, 3);
    assert.ok(analytics.hourly.some((bucket) => bucket.hour === 12 && bucket.total === 1), 'Hourly arrivals must use the configured Asia/Dubai timezone');
    assert.ok(analytics.hourly.some((bucket) => bucket.hour === 13 && bucket.total === 1), `Unexpected company-local hourly analytics buckets: ${JSON.stringify(analytics.hourly)}`);

    const pdfExport = await fetch(`http://127.0.0.1:${address.port}/api/reports/export.pdf?date=2026-11-08`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(pdfExport.status, 200, await pdfExport.clone().text());
    assert.match(pdfExport.headers.get('content-type') ?? '', /application\/pdf/);
    assert.match(pdfExport.headers.get('content-disposition') ?? '', /queuesystem-report-2026-11-08\.pdf/);
    const pdfBytes = Buffer.from(await pdfExport.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 8).toString('ascii'), '%PDF-1.3', 'PDFKit currently emits a valid PDF 1.3 document');
    // PDFKit encodes text through font-specific character maps, so raw ASCII
    // substring checks are not reliable. Verify the API response retains the
    // embedded font and Unicode map used for searchable/copyable report text.
    assert.ok(pdfBytes.includes(Buffer.from('/FontFile2')), 'API PDF must embed its Arabic-capable TrueType font');
    assert.ok(pdfBytes.includes(Buffer.from('/ToUnicode')), 'API PDF must include Unicode mappings for report text');

    const excelExport = await fetch(`http://127.0.0.1:${address.port}/api/reports/export.xlsx?date=2026-11-08`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(excelExport.status, 200, await excelExport.clone().text());
    assert.match(excelExport.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
    assert.match(excelExport.headers.get('content-disposition') ?? '', /queuesystem-report-2026-11-08\.xlsx/);
    const excelBytes = Buffer.from(await excelExport.arrayBuffer());
    assert.equal(excelBytes.readUInt32LE(0), 0x04034b50, 'Excel export must be a real ZIP-based XLSX workbook');
    assert.equal(excelBytes.readUInt32LE(excelBytes.length - 22), 0x06054b50, 'XLSX archive must include its end-of-central-directory record');
    assert.ok(excelBytes.includes(Buffer.from('xl/worksheets/sheet1.xml')));
    assert.ok(excelBytes.includes(Buffer.from('QueueSystem - Daily Queue Report')));
    const worksheetBytes = readStoredZipEntry(excelBytes, 'xl/worksheets/sheet1.xml');
    assert.ok(worksheetBytes, 'XLSX must contain a readable worksheet entry');
    const worksheetXml = worksheetBytes.toString('utf8');
    assert.match(worksheetXml, /Ticket Number/);
    assert.match(worksheetXml, /خدمة المصدر/);
    assert.match(worksheetXml, /1001/);
    assert.match(worksheetXml, /Service \(Arabic\)/);
    assert.match(worksheetXml, /Category \(Arabic\)/);
    assert.match(worksheetXml, /<autoFilter ref="A4:L/);
    // PDF text is encoded in font-specific hex strings, not literal ASCII.
    // PDF validity and embedded Unicode font mappings are asserted above.

    const invalidPdfExport = await fetch(`http://127.0.0.1:${address.port}/api/reports/export.pdf?date=2026-02-30`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(invalidPdfExport.status, 400);

    const reversedAnalyticsRange = await fetch(`http://127.0.0.1:${address.port}/api/reports/analytics?from=2026-11-09&to=2026-11-08`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(reversedAnalyticsRange.status, 400);
    const oversizedAnalyticsRange = await fetch(`http://127.0.0.1:${address.port}/api/reports/analytics?from=2026-01-01&to=2026-04-01`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(oversizedAnalyticsRange.status, 400);
    const invalidAnalyticsDate = await fetch(`http://127.0.0.1:${address.port}/api/reports/analytics?from=2026-02-30&to=2026-03-01`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(invalidAnalyticsDate.status, 400);
    const invalidAnalyticsService = await fetch(`http://127.0.0.1:${address.port}/api/reports/analytics?from=2026-11-08&to=2026-11-08&serviceId=invalid`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(invalidAnalyticsService.status, 400);

    const invalidDailyReportDate = await fetch('http://127.0.0.1:' + address.port + '/api/reports?date=2026-02-30', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(invalidDailyReportDate.status, 400, 'daily reports must reject impossible calendar dates');
    const invalidDailyReportService = await fetch('http://127.0.0.1:' + address.port + '/api/reports?date=2026-11-08&serviceId=invalid', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(invalidDailyReportService.status, 400, 'daily reports must reject invalid service IDs');
    const invalidExportDate = await fetch('http://127.0.0.1:' + address.port + '/api/reports/export?date=2026-02-30', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(invalidExportDate.status, 400, 'CSV export must reject impossible calendar dates');
    const invalidExportService = await fetch('http://127.0.0.1:' + address.port + '/api/reports/export?date=2026-11-08&serviceId=invalid', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(invalidExportService.status, 400, 'CSV export must reject invalid service IDs');

    const filteredTicketPage = await fetch(`http://127.0.0.1:${address.port}/api/tickets?status=completed&serviceId=${sourceService}&page=2&limit=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(filteredTicketPage.status, 200);
    const filteredPageData = await filteredTicketPage.json() as {
      tickets: { number: string }[];
      pagination: { total: number; totalPages: number };
    };
    assert.deepEqual(filteredPageData.tickets.map((ticket) => ticket.number), ['9002']);
    assert.equal(filteredPageData.pagination.total, 2);
    assert.equal(filteredPageData.pagination.totalPages, 2);

    const invalidTicketPage = await fetch(`http://127.0.0.1:${address.port}/api/tickets?page=0`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(invalidTicketPage.status, 400, 'page numbers must be positive whole numbers');

    for (const indexName of [
      'idx_tickets_created_id',
      'idx_tickets_status_created_id',
      'idx_tickets_service_created_id',
      'idx_tickets_counter_status',
      'idx_tickets_queue_lookup',
      'idx_queue_events_ticket_type_id',
    ]) {
      assert.ok(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName),
        `migration must create ${indexName}`,
      );
    }

    const migratedLegacySession = db.prepare('SELECT token FROM sessions WHERE user_id = ? AND token = ?')
      .get(userId, auth.hashToken(legacyToken));
    assert.ok(migratedLegacySession, 'legacy session should be upgraded to a token digest');

    const transferRequest = (bearer: string, ticket: number, service: number, counter: number) => fetch(`http://127.0.0.1:${address.port}/api/tickets/transfer`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticket, to_service_id: service, to_counter_id: counter }),
    });

    // A service officer must be assigned to the ticket's current/pinned counter.
    const unassignedOfficerId = Number(db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES ('unassigned-officer', 'test-hash', 'Unassigned Officer', 'service_officer', 1)",
    ).run().lastInsertRowid);
    const unassignedOfficerToken = middleware.createSession(unassignedOfficerId);
    const unauthorizedTransfer = await transferRequest(unassignedOfficerToken, ticketId, targetService, targetCounter);
    assert.equal(unauthorizedTransfer.status, 403,
      'a service officer without an active assignment at the ticket source counter must not transfer it');

    const wrongTargetService = await transferRequest(token, ticketId, sourceService, targetCounter);
    assert.equal(wrongTargetService.status, 400,
      'the selected target service must be assigned to the target counter');

    const missingTargetService = await transferRequest(token, ticketId, 999999, targetCounter);
    assert.equal(missingTargetService.status, 404, 'a missing target service must be rejected');
    const missingTargetCounter = await transferRequest(token, ticketId, targetService, 999999);
    assert.equal(missingTargetCounter.status, 404, 'a missing target counter must be rejected');

    db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(targetService);
    const inactiveTargetService = await transferRequest(token, ticketId, targetService, targetCounter);
    assert.equal(inactiveTargetService.status, 404, 'an inactive target service must be rejected');
    db.prepare('UPDATE services SET is_active = 1 WHERE id = ?').run(targetService);

    db.prepare('UPDATE counters SET is_active = 0 WHERE id = ?').run(targetCounter);
    const inactiveTargetCounter = await transferRequest(token, ticketId, targetService, targetCounter);
    assert.equal(inactiveTargetCounter.status, 404, 'an inactive target counter must be rejected');
    db.prepare('UPDATE counters SET is_active = 1 WHERE id = ?').run(targetCounter);

    const sameSourceCounter = await transferRequest(token, ticketId, sourceService, sourceCounter);
    assert.equal(sameSourceCounter.status, 400, 'a ticket cannot be transferred back to its current counter');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/tickets/transfer`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ticket_id: ticketId,
        to_service_id: targetService,
        to_counter_id: targetCounter,
      }),
    });

    assert.equal(response.status, 200, await response.text());
    const ticket = db.prepare('SELECT service_id, status, counter_id, queued_for_counter_id, transfer_priority FROM tickets WHERE id = ?')
      .get(ticketId) as {
        service_id: number;
        status: string;
        counter_id: number | null;
        queued_for_counter_id: number | null;
        transfer_priority: number;
      };
    assert.equal(ticket.service_id, targetService);
    assert.equal(ticket.status, 'waiting');
    assert.equal(ticket.counter_id, null);
    assert.equal(ticket.queued_for_counter_id, targetCounter);
    assert.equal(ticket.transfer_priority, 1);
    const repeatedSameCounterTransfer = await transferRequest(token, ticketId, targetService, targetCounter);
    assert.equal(repeatedSameCounterTransfer.status, 400,
      'a waiting transferred ticket remains pinned and cannot be transferred to the same counter again');
    const unassignedRepeatTransfer = await transferRequest(unassignedOfficerToken, ticketId, targetService, sourceCounter);
    assert.equal(unassignedRepeatTransfer.status, 403,
      'a transferred waiting ticket must remain protected by its pinned target-counter assignment');


    const unauthorizedCounterCall = await fetch(`http://127.0.0.1:${address.port}/api/tickets/call-next`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ counter_id: targetCounter }),
    });
    assert.equal(unauthorizedCounterCall.status, 403,
      'service officers must not call tickets from counters outside their active assignment');

    const setupStatusBefore = await fetch(`http://127.0.0.1:${address.port}/api/setup/status`);
    assert.equal(setupStatusBefore.status, 200);
    assert.deepEqual(await setupStatusBefore.json(), { required: true }, 'fresh installs must require the one-time setup wizard');

    const setupResponse = await fetch(`http://127.0.0.1:${address.port}/api/setup/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationNameEn: 'Test Organization',
        organizationNameAr: 'مؤسسة الاختبار',
        businessTimezone: 'Asia/Dubai',
        businessDayStart: '06:00',
        username: 'admin',
        displayName: 'Test Administrator',
        password: firstRunPassword,
        language: 'both',
      }),
    });
    assert.equal(setupResponse.status, 201, await setupResponse.clone().text());
    const setupResult = await setupResponse.json() as { token: string; user: { username: string; display_name: string; role: string } };
    assert.equal(setupResult.user.username, 'admin');
    assert.equal(setupResult.user.display_name, 'Test Administrator');
    assert.equal(setupResult.user.role, 'admin');
    assert.ok(setupResult.token.length > 20, 'setup completion must create an authenticated admin session');
    const configuredAdmin = db.prepare('SELECT username, password_hash, is_active FROM users WHERE username = ? AND role = ?')
      .get(setupResult.user.username, 'admin') as { username: string; password_hash: string; is_active: number };
    assert.equal(configuredAdmin.username, setupResult.user.username, 'setup must persist the selected admin username');
    assert.equal(configuredAdmin.is_active, 1, 'setup must leave the initial administrator active');
    assert.equal(auth.verifyPassword(firstRunPassword, configuredAdmin.password_hash), true,
      'setup must persist a password hash that the login verifier accepts');

    const setupStatusAfter = await fetch(`http://127.0.0.1:${address.port}/api/setup/status`);
    assert.deepEqual(await setupStatusAfter.json(), { required: false }, 'completed setup must never be shown again');
    const duplicateSetup = await fetch(`http://127.0.0.1:${address.port}/api/setup/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationNameEn: 'Another Organization',
        organizationNameAr: 'مؤسسة أخرى',
        businessTimezone: 'Asia/Dubai',
        businessDayStart: '06:00',
        username: 'admin',
        displayName: 'Another Administrator',
        password: firstRunPassword,
        language: 'en',
      }),
    });
    assert.equal(duplicateSetup.status, 409, 'the setup endpoint must reject a second completion');

    const firstRunLogin = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: firstRunPassword }),
    });
    assert.equal(firstRunLogin.status, 200, await firstRunLogin.text());

    // A bootstrap environment value must never authenticate after the database
    // has already replaced its first-run admin password hash.
    const previousBootstrapPassword = process.env.ADMIN_INITIAL_PASSWORD;
    process.env.ADMIN_INITIAL_PASSWORD = 'test-bootstrap-password-that-must-not-work';
    const bootstrapLogin = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD }),
    });
    assert.equal(bootstrapLogin.status, 401, await bootstrapLogin.text());
    if (previousBootstrapPassword === undefined) delete process.env.ADMIN_INITIAL_PASSWORD;
    else process.env.ADMIN_INITIAL_PASSWORD = previousBootstrapPassword;

    const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
    const adminToken = middleware.createSession(admin.id);

    // Staff assignment APIs are admin-only, and active assignments must be unique.
    const receptionistId = Number(db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, 'receptionist', 1)",
    ).run('assignment-receptionist', 'test-hash', 'Assignment Receptionist').lastInsertRowid);
    const receptionistToken = middleware.createSession(receptionistId);
    const officerTwoId = Number(db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, 'service_officer', 1)",
    ).run('assignment-officer-two', 'test-hash', 'Assignment Officer Two').lastInsertRowid);
    const officerThreeId = Number(db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, 'service_officer', 1)",
    ).run('assignment-officer-three', 'test-hash', 'Assignment Officer Three').lastInsertRowid);
    const thirdCounter = Number(db.prepare(
      "INSERT INTO counters (number, name, is_active) VALUES (3, 'Reassignment Target', 1)",
    ).run().lastInsertRowid);
    const officerAssignmentHeaders = {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    };
    for (const roleToken of [token, receptionistToken]) {
      const deniedAssignments = await fetch(`http://127.0.0.1:${address.port}/api/staff/assignments`, {
        headers: { authorization: `Bearer ${roleToken}` },
      });
      assert.equal(deniedAssignments.status, 403,
        'service officers and receptionists must not view staff assignments');
      const deniedAssignmentCreate = await fetch(`http://127.0.0.1:${address.port}/api/staff/assignments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${roleToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: officerTwoId, counter_id: targetCounter }),
      });
      assert.equal(deniedAssignmentCreate.status, 403,
        'service officers and receptionists must not create staff assignments');
    }
    const officerAssignment = await fetch(`http://127.0.0.1:${address.port}/api/staff/assignments`, {
      method: 'POST',
      headers: officerAssignmentHeaders,
      body: JSON.stringify({ user_id: officerTwoId, counter_id: targetCounter }),
    });
    assert.equal(officerAssignment.status, 200, await officerAssignment.clone().text());
    const officerAssignmentData = await officerAssignment.json() as { id: number };
    const duplicateCounterAssignment = await fetch(`http://127.0.0.1:${address.port}/api/staff/assignments`, {
      method: 'POST',
      headers: officerAssignmentHeaders,
      body: JSON.stringify({ user_id: officerThreeId, counter_id: targetCounter }),
    });
    assert.equal(duplicateCounterAssignment.status, 409,
      'a counter must not receive a second active staff assignment');
    const reassignment = await fetch(`http://127.0.0.1:${address.port}/api/staff/assignments`, {
      method: 'POST',
      headers: officerAssignmentHeaders,
      body: JSON.stringify({ user_id: officerTwoId, counter_id: thirdCounter }),
    });
    assert.equal(reassignment.status, 200, await reassignment.clone().text());
    const reassignmentData = await reassignment.json() as { id: number };
    assert.notEqual(reassignmentData.id, officerAssignmentData.id);
    const assignmentHistory = db.prepare(
      'SELECT id, counter_id, status, ended_at FROM staff_assignments WHERE user_id = ? ORDER BY id',
    ).all(officerTwoId) as Array<{ id: number; counter_id: number; status: string; ended_at: string | null }>;
    assert.deepEqual(assignmentHistory.map(({ counter_id, status }) => [counter_id, status]), [
      [targetCounter, 'ended'], [thirdCounter, 'active'],
    ], 'reassignment must end the previous active assignment before creating the new one');
    assert.ok(assignmentHistory[0].ended_at, 'ended assignment must record its end timestamp');

    // Exercise a complete two-hop transfer: the same ticket must retain its
    // number and original creation time while its pinned counter changes.
    db.prepare('INSERT INTO counter_services (counter_id, service_id) VALUES (?, ?)').run(thirdCounter, targetService);
    const officerThreeToken = middleware.createSession(officerThreeId);
    const officerThreeSourceAssignment = await fetch(`http://127.0.0.1:${address.port}/api/staff/assignments`, {
      method: 'POST',
      headers: officerAssignmentHeaders,
      body: JSON.stringify({ user_id: officerThreeId, counter_id: targetCounter }),
    });
    assert.equal(officerThreeSourceAssignment.status, 200, await officerThreeSourceAssignment.clone().text());

    const beforeSecondTransfer = db.prepare(
      'SELECT id, number, created_at, service_id, queued_for_counter_id FROM tickets WHERE id = ?',
    ).get(ticketId) as { id: number; number: string; created_at: string; service_id: number; queued_for_counter_id: number };
    assert.equal(beforeSecondTransfer.queued_for_counter_id, targetCounter);
    const secondHop = await transferRequest(officerThreeToken, ticketId, targetService, thirdCounter);
    assert.equal(secondHop.status, 200, await secondHop.clone().text());
    const afterSecondTransfer = db.prepare(
      'SELECT id, number, created_at, service_id, status, counter_id, queued_for_counter_id, transfer_priority FROM tickets WHERE id = ?',
    ).get(ticketId) as {
      id: number; number: string; created_at: string; service_id: number; status: string;
      counter_id: number | null; queued_for_counter_id: number; transfer_priority: number;
    };
    assert.deepEqual(afterSecondTransfer, {
      ...beforeSecondTransfer,
      status: 'waiting',
      counter_id: null,
      queued_for_counter_id: thirdCounter,
      transfer_priority: 1,
    }, 'a second transfer must preserve the same ticket ID, number, creation time and service identity while pinning the new counter');
    const transferEvents = db.prepare(
      "SELECT event_type FROM queue_events WHERE ticket_id = ? AND event_type = 'transferred' ORDER BY id",
    ).all(ticketId) as { event_type: string }[];
    assert.equal(transferEvents.length, 2, 'ticket history must retain both transfer events');

    const reactivatePreviousAssignment = await fetch(
      `http://127.0.0.1:${address.port}/api/staff/assignments/${officerAssignmentData.id}`,
      {
        method: 'PUT',
        headers: officerAssignmentHeaders,
        body: JSON.stringify({ status: 'active' }),
      },
    );
    assert.equal(reactivatePreviousAssignment.status, 409,
      'a staff member must not reactivate an old assignment while another counter assignment is active');
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM staff_assignments WHERE user_id = ? AND status = 'active'").get(officerTwoId) as { count: number }).count,
      1,
      'a staff member must have at most one active counter assignment',
    );

    // A transferred waiting ticket is still pinned to the target counter.
    // Disabling or deleting that counter must not silently unpin the ticket.
    const disableResponse = await fetch(`http://127.0.0.1:${address.port}/api/counters/${thirdCounter}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert.equal(disableResponse.status, 409, await disableResponse.text());

    const deleteResponse = await fetch(`http://127.0.0.1:${address.port}/api/counters/${thirdCounter}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteResponse.status, 409, await deleteResponse.text());
    assert.ok(db.prepare('SELECT id FROM counters WHERE id = ?').get(thirdCounter));

    const officerBackupList = await fetch(`http://127.0.0.1:${address.port}/api/backups`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(officerBackupList.status, 403, 'non-admin staff must not access database backups');

    const backupResponse = await fetch(`http://127.0.0.1:${address.port}/api/backup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(backupResponse.status, 200, await backupResponse.clone().text());
    const backupResult = await backupResponse.json() as { filename: string; sizeBytes: number; retentionCount: number };
    assert.match(backupResult.filename, /^queuesystem-backup-[\dTZ-]+\.db$/);
    assert.ok(backupResult.sizeBytes > 0, 'backup endpoint must return a non-empty database snapshot');
    assert.equal(backupResult.retentionCount, 30);

    const backupListResponse = await fetch(`http://127.0.0.1:${address.port}/api/backups`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(backupListResponse.status, 200, await backupListResponse.clone().text());
    const backupList = await backupListResponse.json() as {
      backups: { id: number; filename: string; size_bytes: number }[];
    };
    const createdBackup = backupList.backups.find((item) => item.filename === backupResult.filename);
    assert.ok(createdBackup, 'created backup must appear in the backup history');
    assert.equal(createdBackup.size_bytes, backupResult.sizeBytes);

    const backupDownloadResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/backups/${createdBackup.id}/download`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert.equal(backupDownloadResponse.status, 200, await backupDownloadResponse.clone().text());
    assert.ok(backupDownloadResponse.headers.get('content-disposition')?.includes(backupResult.filename));
    const backupSnapshotPath = path.join(directory, 'downloaded-backup-test.db');
    fs.writeFileSync(backupSnapshotPath, Buffer.from(await backupDownloadResponse.arrayBuffer()));
    const backupSnapshot = new Database(backupSnapshotPath, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(backupSnapshot.pragma('integrity_check'), [{ integrity_check: 'ok' }],
        'downloaded backup must be a valid SQLite database');
    } finally {
      backupSnapshot.close();
    }

    const callNextResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets/call-next`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ counter_id: thirdCounter }),
    });
    assert.equal(callNextResponse.status, 200, await callNextResponse.clone().text());
    const callNextData = await callNextResponse.json() as { ticket: { id: number; number: string } };
    assert.equal(callNextData.ticket.id, ticketId, 'call-next must select the transferred ticket pinned to this counter');
    assert.equal(callNextData.ticket.number, '1001', 'transfers must preserve the original ticket number');
    const calledTicket = db.prepare('SELECT status, counter_id FROM tickets WHERE id = ?').get(ticketId) as {
      status: string; counter_id: number | null;
    };
    assert.equal(calledTicket.status, 'called');
    assert.equal(calledTicket.counter_id, thirdCounter);

    const duplicateCallNext = await fetch(`http://127.0.0.1:${address.port}/api/tickets/call-next`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ counter_id: thirdCounter }),
    });
    assert.equal(duplicateCallNext.status, 409,
      'a counter with an active called ticket must not call a second ticket');

    const recallResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets/recall`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId }),
    });
    assert.equal(recallResponse.status, 200, await recallResponse.text());
    assert.equal((db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticketId) as { status: string }).status, 'called',
      'recall must keep the ticket in called state');

    const startServingResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets/start-serving`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId }),
    });
    assert.equal(startServingResponse.status, 200, await startServingResponse.text());
    assert.equal((db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticketId) as { status: string }).status, 'serving',
      'start-serving must transition the ticket from called to serving');

    const completeResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId }),
    });
    assert.equal(completeResponse.status, 200, await completeResponse.text());
    const completedTicket = db.prepare('SELECT status, counter_id, completed_at FROM tickets WHERE id = ?').get(ticketId) as {
      status: string; counter_id: number | null; completed_at: string | null;
    };
    assert.equal(completedTicket.status, 'completed');
    assert.equal(completedTicket.counter_id, thirdCounter);
    assert.ok(completedTicket.completed_at, 'completion timestamp must be stored');

    const duplicateCompleteResponse = await fetch(`http://127.0.0.1:${address.port}/api/tickets/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId }),
    });
    assert.equal(duplicateCompleteResponse.status, 409, 'a completed ticket must not be completed twice');
    const workflowEvents = db.prepare(
      'SELECT event_type, from_status, to_status FROM queue_events WHERE ticket_id = ? ORDER BY id',
    ).all(ticketId) as { event_type: string; from_status: string | null; to_status: string | null }[];
    assert.deepEqual(workflowEvents.map((event) => event.event_type), ['created', 'transferred', 'transferred', 'called', 'recalled', 'started', 'completed']);
    assert.deepEqual(workflowEvents.slice(-4).map((event) => [event.from_status, event.to_status]), [
      ['waiting', 'called'], ['called', 'called'], ['called', 'serving'], ['serving', 'completed'],
    ]);

    const settingsAuditResponse = await fetch(`http://127.0.0.1:${address.port}/api/settings`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { ticket_padding: 4 } }),
    });
    assert.equal(settingsAuditResponse.status, 200, await settingsAuditResponse.text());

    // Service-management API and database regression coverage.
    const serviceHeaders = {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    };
    const serviceListResponse = await fetch(`http://127.0.0.1:${address.port}/api/services`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(serviceListResponse.status, 200);
    const serviceListData = await serviceListResponse.json() as {
      services: { id: number; code: string; assigned_counters: number }[];
    };
    assert.ok(serviceListData.services.some((service) => service.id === sourceService && service.assigned_counters === 1));
    assert.ok(serviceListData.services.some((service) => service.id === targetService && service.assigned_counters === 1));

    const createServiceResponse = await fetch(`http://127.0.0.1:${address.port}/api/services`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        name: 'Test Service',
        name_ar: 'خدمة الاختبار',
        code: 'TST',
        prefix: 'X',
        description: 'Service-layer integration fixture',
        avg_duration_sec: 240,
        ticket_range_start: 3000,
        ticket_range_end: 3999,
      }),
    });
    assert.equal(createServiceResponse.status, 200);
    const createdServiceData = await createServiceResponse.json() as { id: number };
    const createdServiceId = createdServiceData.id;
    assert.ok(Number.isInteger(createdServiceId) && createdServiceId > 0);
    const createdServiceRow = db.prepare(
      'SELECT name, name_ar, code, prefix, avg_duration_sec, ticket_range_start, ticket_range_end FROM services WHERE id = ?',
    ).get(createdServiceId) as {
      name: string; name_ar: string; code: string; prefix: string; avg_duration_sec: number;
      ticket_range_start: number; ticket_range_end: number;
    };
    assert.deepEqual(createdServiceRow, {
      name: 'Test Service',
      name_ar: 'خدمة الاختبار',
      code: 'TST',
      prefix: 'X',
      avg_duration_sec: 240,
      ticket_range_start: 3000,
      ticket_range_end: 3999,
    });
    assert.ok(db.prepare('SELECT service_id FROM ticket_sequences WHERE service_id = ?').get(createdServiceId),
      'creating a service must create its ticket sequence in the same transaction');

    const invalidServiceCreate = await fetch(`http://127.0.0.1:${address.port}/api/services`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        name: ' ',
        name_ar: 'خدمة',
        code: 'BAD',
        prefix: 'B',
        ticket_range_start: 5000,
        ticket_range_end: 5999,
      }),
    });
    assert.equal(invalidServiceCreate.status, 400);

    const duplicateServiceCode = await fetch(`http://127.0.0.1:${address.port}/api/services`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        name: 'Duplicate Code',
        name_ar: 'رمز مكرر',
        code: 'SRC',
        prefix: 'D',
        ticket_range_start: 5000,
        ticket_range_end: 5999,
      }),
    });
    assert.equal(duplicateServiceCode.status, 409);

    const overlappingServiceRange = await fetch(`http://127.0.0.1:${address.port}/api/services`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        name: 'Overlapping Range',
        name_ar: 'نطاق متداخل',
        code: 'OVR',
        prefix: 'O',
        ticket_range_start: 1200,
        ticket_range_end: 1299,
      }),
    });
    assert.equal(overlappingServiceRange.status, 409);

    const updateServiceResponse = await fetch(`http://127.0.0.1:${address.port}/api/services/${createdServiceId}`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ name: 'Updated Test Service', ticket_range_start: 4000, ticket_range_end: 4999 }),
    });
    assert.equal(updateServiceResponse.status, 200);
    const updatedServiceRow = db.prepare('SELECT name, ticket_range_start, ticket_range_end FROM services WHERE id = ?')
      .get(createdServiceId) as { name: string; ticket_range_start: number; ticket_range_end: number };
    assert.deepEqual(updatedServiceRow, {
      name: 'Updated Test Service',
      ticket_range_start: 4000,
      ticket_range_end: 4999,
    });

    const duplicateServiceUpdate = await fetch(`http://127.0.0.1:${address.port}/api/services/${createdServiceId}`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ code: 'TGT' }),
    });
    assert.equal(duplicateServiceUpdate.status, 409);

    const overlappingServiceUpdate = await fetch(`http://127.0.0.1:${address.port}/api/services/${createdServiceId}`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ ticket_range_start: 1000, ticket_range_end: 1100 }),
    });
    assert.equal(overlappingServiceUpdate.status, 409);
    const rangeAfterRejectedUpdate = db.prepare('SELECT ticket_range_start, ticket_range_end FROM services WHERE id = ?')
      .get(createdServiceId) as { ticket_range_start: number; ticket_range_end: number };
    assert.deepEqual(rangeAfterRejectedUpdate, { ticket_range_start: 4000, ticket_range_end: 4999 },
      'a rejected overlapping update must leave the existing range unchanged');

    const missingServiceUpdate = await fetch(`http://127.0.0.1:${address.port}/api/services/999999`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ name: 'Missing' }),
    });
    assert.equal(missingServiceUpdate.status, 404);

    const invalidServiceIdUpdate = await fetch(`http://127.0.0.1:${address.port}/api/services/not-a-number`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ name: 'Invalid ID' }),
    });
    assert.equal(invalidServiceIdUpdate.status, 400);

    const deleteServiceWithTickets = await fetch(`http://127.0.0.1:${address.port}/api/services/${sourceService}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteServiceWithTickets.status, 409);
    assert.ok(db.prepare('SELECT id FROM services WHERE id = ?').get(sourceService),
      'service history must remain intact when deletion is rejected');

    const deleteCreatedService = await fetch(`http://127.0.0.1:${address.port}/api/services/${createdServiceId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteCreatedService.status, 200);
    assert.equal(db.prepare('SELECT id FROM services WHERE id = ?').get(createdServiceId), undefined);

    const deleteMissingService = await fetch(`http://127.0.0.1:${address.port}/api/services/999999`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteMissingService.status, 404);

    // Upload mutations require an authenticated admin session.
    const unauthenticatedUpload = await fetch(`http://127.0.0.1:${address.port}/api/logo/upload`, {
      method: 'POST',
      body: (() => { const form = new FormData(); form.append('logo', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'unauthorized.png'); return form; })(),
    });
    assert.equal(unauthenticatedUpload.status, 401);

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const logoForm = new FormData();
    logoForm.append('logo', new Blob([pngHeader], { type: 'image/png' }), 'brand.png');
    const validLogo = await fetch(`http://127.0.0.1:${address.port}/api/logo/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: logoForm,
    });
    assert.equal(validLogo.status, 200, await validLogo.text());
    const logoRecord = db.prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() as { value: string };
    assert.match(logoRecord.value, /^logo-[a-f0-9-]+\.png$/);

    const spoofedLogoForm = new FormData();
    spoofedLogoForm.append('logo', new Blob([pngHeader], { type: 'image/jpeg' }), 'spoofed.png');
    const spoofedLogo = await fetch(`http://127.0.0.1:${address.port}/api/logo/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: spoofedLogoForm,
    });
    assert.equal(spoofedLogo.status, 400, 'MIME type and extension must agree');

    const fakeLogoForm = new FormData();
    fakeLogoForm.append('logo', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'fake.png');
    const fakeLogo = await fetch(`http://127.0.0.1:${address.port}/api/logo/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: fakeLogoForm,
    });
    assert.equal(fakeLogo.status, 400, 'image content must match its extension');
    const remainingLogoFiles = fs.existsSync(process.env.LOGO_DIR!) ? fs.readdirSync(process.env.LOGO_DIR!) : [];
    assert.deepEqual(remainingLogoFiles, [logoRecord.value], 'rejected logo files must be removed from disk');

    const oversizedLogoForm = new FormData();
    oversizedLogoForm.append('logo', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'oversized.png');
    const oversizedLogo = await fetch(`http://127.0.0.1:${address.port}/api/logo/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: oversizedLogoForm,
    });
    assert.equal(oversizedLogo.status, 413, 'logo size limit must be enforced before content validation');
    assert.equal(db.prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() && (db.prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() as { value: string }).value, logoRecord.value, 'rejected uploads must not replace the current logo');

    const mp4Header = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
    const videoForm = new FormData();
    videoForm.append('video', new Blob([mp4Header], { type: 'video/mp4' }), '..\\..\\sample.mp4');
    const validVideo = await fetch(`http://127.0.0.1:${address.port}/api/ads/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: videoForm,
    });
    assert.equal(validVideo.status, 200, await validVideo.text());

    const mismatchedVideoMimeForm = new FormData();
    mismatchedVideoMimeForm.append('video', new Blob([mp4Header], { type: 'video/webm' }), 'wrong-mime.mp4');
    const mismatchedVideoMime = await fetch(`http://127.0.0.1:${address.port}/api/ads/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: mismatchedVideoMimeForm,
    });
    assert.equal(mismatchedVideoMime.status, 400, 'video MIME type must match its extension');
    const storedAd = db.prepare('SELECT filename, original_name FROM ads ORDER BY id DESC LIMIT 1').get() as { filename: string; original_name: string };
    assert.match(storedAd.filename, /^ad-[a-f0-9-]+\.mp4$/);
    assert.equal(storedAd.original_name, 'sample.mp4', 'client-supplied path segments must not be stored');

    const fakeVideoForm = new FormData();
    fakeVideoForm.append('video', new Blob(['not a video'], { type: 'video/mp4' }), 'fake.mp4');
    const fakeVideo = await fetch(`http://127.0.0.1:${address.port}/api/ads/upload`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: fakeVideoForm,
    });
    assert.equal(fakeVideo.status, 400, 'video content must match its extension');
    assert.deepEqual(fs.readdirSync(process.env.ADS_DIR!), [storedAd.filename], 'rejected video files must be removed from disk');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ads').get() && (db.prepare('SELECT COUNT(*) AS count FROM ads').get() as { count: number }).count, 1, 'rejected video must not create advertisement metadata');

    const signatureDirectory = path.join(directory, 'signature-tests');
    fs.mkdirSync(signatureDirectory, { recursive: true });
    const signatureCases = [
      ['valid.webp', Buffer.from('RIFF0000WEBP'), 'image', '.webp', true],
      ['invalid.webp', Buffer.from('RIFF0000NOPE'), 'image', '.webp', false],
      ['valid.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video', '.webm', true],
      ['valid.ogg', Buffer.from('OggS'), 'video', '.ogg', true],
      ['invalid.mp4', Buffer.from('plain text'), 'video', '.mp4', false],
    ] as const;
    for (const [name, bytes, kind, extension, expected] of signatureCases) {
      const target = path.join(signatureDirectory, name);
      fs.writeFileSync(target, bytes);
      assert.equal(hasSupportedFileSignature(target, kind, extension), expected, name);
    }


    // Changing a service officer to a non-service-officer role must release
    // their counter assignment so it cannot remain orphaned or block reuse.
    const roleResponse = await fetch(`http://127.0.0.1:${address.port}/api/staff/${userId}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'senior_clerk' }),
    });
    assert.equal(roleResponse.status, 200, await roleResponse.text());
    const assignment = db.prepare('SELECT status FROM staff_assignments WHERE user_id = ?').get(userId) as { status: string };
    assert.equal(assignment.status, 'ended');

    const unauthorizedAuditLogs = await fetch(`http://127.0.0.1:${address.port}/api/staff/audit-logs`);
    assert.equal(unauthorizedAuditLogs.status, 401, 'audit history must require administrator authentication');
    const auditLogsResponse = await fetch(`http://127.0.0.1:${address.port}/api/staff/audit-logs?limit=100`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(auditLogsResponse.status, 200, await auditLogsResponse.clone().text());
    const auditLogsData = await auditLogsResponse.json() as {
      logs: { action: string; actor_username: string; details: Record<string, unknown> }[];
    };
    assert.ok(auditLogsData.logs.some((log) => log.action === 'staff.account.updated' && log.actor_username === 'admin'),
      'staff account changes must be visible in the admin activity history');
    assert.ok(auditLogsData.logs.some((log) => log.action === 'auth.login.succeeded'),
      'successful sign-ins must be visible in the admin activity history');
    assert.ok(auditLogsData.logs.some((log) => log.action === 'queue.ticket.transferred' && log.actor_username === 'counter-officer'),
      'ticket transfers must be visible with the acting staff member');
    assert.ok(auditLogsData.logs.some((log) => log.action === 'settings.updated' && log.actor_username === 'admin'),
      'system settings changes must be visible in the admin activity history');
    assert.equal(auditLogsData.logs.some((log) => JSON.stringify(log).includes(firstRunPassword)), false,
      'audit history must never expose passwords');

    // Five failures for one username block that account/IP pair and return a
    // Retry-After hint without revealing whether the username exists.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'rate-limit-account', password: 'wrong-password' }),
      });
      assert.equal(failed.status, 401);
    }
    const accountBlocked = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rate-limit-account', password: 'wrong-password' }),
    });
    assert.equal(accountBlocked.status, 429);
    assert.ok(Number(accountBlocked.headers.get('retry-after')) > 0);

    const failedLoginAuditResponse = await fetch(`http://127.0.0.1:${address.port}/api/staff/audit-logs?limit=200`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(failedLoginAuditResponse.status, 200, await failedLoginAuditResponse.clone().text());
    const failedLoginAuditData = await failedLoginAuditResponse.json() as {
      logs: { action: string; actor_username: string }[];
    };
    assert.ok(failedLoginAuditData.logs.some((log) =>
      log.action === 'auth.login.failed' && log.actor_username === 'rate-limit-account'),
    'failed sign-in attempts must be visible in the admin activity history');
    assert.equal(JSON.stringify(failedLoginAuditData.logs).includes('wrong-password'), false,
      'failed sign-in audit events must never expose passwords');

    // A second limit applies across different usernames from the same IP.
    // One earlier failed admin login plus the five above leaves 14 attempts.
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const failed = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: `ip-limit-${attempt}`, password: 'wrong-password' }),
      });
      assert.equal(failed.status, 401);
    }
    const ipBlocked = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'different-user-after-ip-limit', password: 'wrong-password' }),
    });
    assert.equal(ipBlocked.status, 429);
    assert.ok(Number(ipBlocked.headers.get('retry-after')) > 0);

    // Expired and malformed bearer tokens must never authenticate.
    const expiredToken = 'b'.repeat(64);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime(\'now\', \'-1 hour\'))')
      .run(auth.hashToken(expiredToken), admin.id);
    const expiredSession = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredSession.status, 401, 'expired sessions must be rejected');
    assert.equal(
      db.prepare('SELECT token FROM sessions WHERE token = ?').get(auth.hashToken(expiredToken)),
      undefined,
      'expired session records must be deleted when encountered',
    );
    const malformedSession = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { authorization: 'Bearer not-a-64-character-hex-token' },
    });
    assert.equal(malformedSession.status, 401, 'malformed bearer tokens must be rejected');

    // Password changes retain the current device session and revoke every other session.
    const secondaryAdminToken = middleware.createSession(admin.id);
    const passwordChange = await fetch(`http://127.0.0.1:${address.port}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: firstRunPassword,
        newPassword: 'test-new-admin-password-2026',
      }),
    });
    assert.equal(passwordChange.status, 200, await passwordChange.text());
    const retainedSession = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(retainedSession.status, 200, 'the device changing its password should remain signed in');
    const revokedSession = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { authorization: `Bearer ${secondaryAdminToken}` },
    });
    assert.equal(revokedSession.status, 401, 'password changes must revoke other sessions');
    const logoutResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(logoutResponse.status, 200, await logoutResponse.text());
    const loggedOutSession = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(loggedOutSession.status, 401, 'logout must immediately invalidate the bearer token');
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDb?.();
    delete process.env.DB_PATH;
    delete process.env.ADS_DIR;
    delete process.env.LOGO_DIR;
    delete process.env.BACKUPS_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('restore swap rolls back the original database when candidate replacement fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-restore-swap-'));
  const databasePath = path.join(directory, 'live.db');
  const candidatePath = path.join(directory, 'candidate.db');
  const rollbackPath = path.join(directory, 'live.db.pre-restore');
  const original = Buffer.from('original-live-database');
  const candidate = Buffer.from('restored-candidate-database');
  fs.writeFileSync(databasePath, original);
  fs.writeFileSync(candidatePath, candidate);

  let injectedFailure = false;
  const operations = {
    exists: (filePath: string) => fs.existsSync(filePath),
    removeFile: (filePath: string) => fs.rmSync(filePath),
    renameFile: (from: string, to: string) => {
      if (from === candidatePath && !injectedFailure) {
        injectedFailure = true;
        throw new Error('simulated candidate replacement failure');
      }
      fs.renameSync(from, to);
    },
  };

  try {
    assert.throws(
      () => replaceDatabaseWithRollback(databasePath, candidatePath, rollbackPath, () => {}, operations),
      /simulated candidate replacement failure/,
    );
    assert.deepEqual(fs.readFileSync(databasePath), original,
      'the original live database must be restored after candidate replacement fails');
    assert.equal(fs.existsSync(rollbackPath), false,
      'successful automatic rollback must move the original file back into place');
    assert.equal(fs.existsSync(candidatePath), true,
      'the uninstalled candidate should remain available for diagnosis');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('restore swap rolls back the original database when final validation fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-restore-validation-swap-'));
  const databasePath = path.join(directory, 'live.db');
  const candidatePath = path.join(directory, 'candidate.db');
  const rollbackPath = path.join(directory, 'live.db.pre-restore');
  const original = Buffer.from('original-live-database');
  fs.writeFileSync(databasePath, original);
  fs.writeFileSync(candidatePath, 'invalid-restored-candidate');

  try {
    assert.throws(
      () => replaceDatabaseWithRollback(
        databasePath,
        candidatePath,
        rollbackPath,
        () => { throw new Error('simulated final integrity validation failure'); },
      ),
      /simulated final integrity validation failure/,
    );
    assert.deepEqual(fs.readFileSync(databasePath), original,
      'the original live database must be restored when final validation fails');
    assert.equal(fs.existsSync(rollbackPath), false,
      'successful rollback must restore the original path');
    assert.equal(fs.existsSync(candidatePath), false,
      'the failed installed candidate must be removed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

