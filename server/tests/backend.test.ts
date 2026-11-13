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

test('business date uses the Abu Dhabi 06:00 boundary regardless of host timezone', () => {
  assert.equal(getBusinessDate(new Date('2026-11-08T01:59:59.000Z')), '2026-11-07', 'one second before 06:00 Abu Dhabi remains on the previous business day');
  assert.equal(getBusinessDate(new Date('2026-11-08T02:00:00.000Z')), '2026-11-08', '06:00 Abu Dhabi starts the new business day');
  assert.equal(getBusinessDate(new Date('2024-03-01T01:59:59.000Z')), '2024-02-29', 'business date handles leap-day rollover');
  assert.equal(getBusinessDate(new Date('2024-03-01T02:00:00.000Z')), '2024-03-01', 'business date advances after the 06:00 boundary');
  assert.throws(() => getBusinessDate(new Date(Number.NaN)), /valid date/);
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
      "INSERT INTO tickets (number, service_id, status, priority, queued_for_counter_id, business_date) VALUES ('1001', ?, 'waiting', 'normal', ?, '2026-11-08')",
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
    assert.ok(analytics.hourly.some((bucket) => bucket.hour === 8 && bucket.total === 1));
    assert.ok(analytics.hourly.some((bucket) => bucket.hour === 9 && bucket.total === 1), `Unexpected hourly analytics buckets: ${JSON.stringify(analytics.hourly)}`);

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

    const setupStatusBefore = await fetch(`http://127.0.0.1:${address.port}/api/setup/status`);
    assert.equal(setupStatusBefore.status, 200);
    assert.deepEqual(await setupStatusBefore.json(), { required: true }, 'fresh installs must require the one-time setup wizard');

    const setupResponse = await fetch(`http://127.0.0.1:${address.port}/api/setup/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationNameEn: 'Test Organization',
        organizationNameAr: 'مؤسسة الاختبار',
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

    const setupStatusAfter = await fetch(`http://127.0.0.1:${address.port}/api/setup/status`);
    assert.deepEqual(await setupStatusAfter.json(), { required: false }, 'completed setup must never be shown again');
    const duplicateSetup = await fetch(`http://127.0.0.1:${address.port}/api/setup/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationNameEn: 'Another Organization',
        organizationNameAr: 'مؤسسة أخرى',
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

    // A transferred waiting ticket is still pinned to the target counter.
    // Disabling or deleting that counter must not silently unpin the ticket.
    const disableResponse = await fetch(`http://127.0.0.1:${address.port}/api/counters/${targetCounter}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert.equal(disableResponse.status, 409, await disableResponse.text());

    const deleteResponse = await fetch(`http://127.0.0.1:${address.port}/api/counters/${targetCounter}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteResponse.status, 409, await deleteResponse.text());
    assert.ok(db.prepare('SELECT id FROM counters WHERE id = ?').get(targetCounter));

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
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDb?.();
    delete process.env.DB_PATH;
    delete process.env.ADS_DIR;
    delete process.env.LOGO_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
