import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { isAllowedWebSocketOrigin } from '../ws/index.js';

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

  let server: http.Server | undefined;
  let closeDb: (() => void) | undefined;

  try {
    const [{ createApp }, database, middleware, auth] = await Promise.all([
      import('../app.js'),
      import('../db/index.js'),
      import('../lib/middleware.js'),
      import('../lib/auth.js'),
    ]);
    closeDb = database.closeDb;
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
      "INSERT INTO queue_events (ticket_id, event_type, from_status, to_status) VALUES (?, 'created', NULL, 'waiting')",
    ).run(ticketId);

    const token = middleware.createSession(userId);
    const storedSession = db.prepare('SELECT token FROM sessions WHERE user_id = ?').get(userId) as { token: string };
    assert.equal(storedSession.token, auth.hashToken(token), 'SQLite must store only the token digest');
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
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
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDb?.();
    delete process.env.DB_PATH;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
