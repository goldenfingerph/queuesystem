import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

test('assigned service officer can transfer a waiting ticket pinned to their counter', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesystem-backend-'));
  process.env.DB_PATH = path.join(directory, 'test.db');

  let server: http.Server | undefined;
  let closeDb: (() => void) | undefined;

  try {
    const [{ createApp }, database, middleware] = await Promise.all([
      import('../app.js'),
      import('../db/index.js'),
      import('../lib/middleware.js'),
    ]);
    closeDb = database.closeDb;
    const db = database.getDb();

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
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
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
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDb?.();
    delete process.env.DB_PATH;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
