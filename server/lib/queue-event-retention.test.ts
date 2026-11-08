import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import test from 'node:test';
import { pruneQueueEvents } from './queue-event-retention.js';

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE queue_events (
      id INTEGER PRIMARY KEY,
      ticket_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const ticket = db.prepare('INSERT INTO tickets (status) VALUES (?)');
  const event = db.prepare('INSERT INTO queue_events (ticket_id, event_type, created_at) VALUES (?, ?, ?)');
  const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  function add(status: string, createdAt: string) {
    const ticketId = Number(ticket.run(status).lastInsertRowid);
    event.run(ticketId, 'completed', createdAt);
    return ticketId;
  }

  return {
    db,
    oldDate,
    recentDate,
    add,
    close: () => db.close(),
  };
}

test('prunes old events for terminal tickets but preserves active ticket history', () => {
  const state = setup();
  try {
    const completedOld = state.add('completed', state.oldDate);
    const noShowOld = state.add('no_show', state.oldDate);
    const transferredOld = state.add('transferred', state.oldDate);
    const completedRecent = state.add('completed', state.recentDate);
    const waitingOld = state.add('waiting', state.oldDate);
    const calledOld = state.add('called', state.oldDate);
    const servingOld = state.add('serving', state.oldDate);

    const result = pruneQueueEvents(state.db);

    assert.equal(result.deleted, 3);
    assert.equal(result.retentionDays, 365);
    const remaining = state.db.prepare('SELECT ticket_id FROM queue_events ORDER BY ticket_id').all() as { ticket_id: number }[];
    assert.deepEqual(remaining.map((row) => row.ticket_id), [
      completedRecent, waitingOld, calledOld, servingOld,
    ]);
    assert.equal(remaining.some((row) => [completedOld, noShowOld, transferredOld].includes(row.ticket_id)), false);
  } finally {
    state.close();
  }
});

test('is safe to run repeatedly', () => {
  const state = setup();
  try {
    state.add('completed', state.oldDate);
    assert.equal(pruneQueueEvents(state.db).deleted, 1);
    assert.equal(pruneQueueEvents(state.db).deleted, 0);
  } finally {
    state.close();
  }
});

test('rejects invalid retention periods', () => {
  const state = setup();
  try {
    assert.throws(() => pruneQueueEvents(state.db, 0), RangeError);
    assert.throws(() => pruneQueueEvents(state.db, 1.5), RangeError);
    assert.throws(() => pruneQueueEvents(state.db, 36501), RangeError);
  } finally {
    state.close();
  }
});
