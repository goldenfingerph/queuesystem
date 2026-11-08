import type Database from 'better-sqlite3';

export const DEFAULT_QUEUE_EVENT_RETENTION_DAYS = 365;
export const QUEUE_EVENT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface QueueEventRetentionResult {
  deleted: number;
  retentionDays: number;
}

/**
 * Prune old audit events only for terminal tickets.
 * Waiting/called/serving ticket history is retained so live queue projections
 * and operational investigation are not affected by age alone.
 */
export function pruneQueueEvents(
  db: Database.Database,
  retentionDays = DEFAULT_QUEUE_EVENT_RETENTION_DAYS,
): QueueEventRetentionResult {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
    throw new RangeError('Queue event retention days must be an integer between 1 and 36500');
  }

  const result = db.prepare(`
    DELETE FROM queue_events
    WHERE datetime(created_at) < datetime('now', ?)
      AND ticket_id IN (
        SELECT id FROM tickets
        WHERE status IN ('completed', 'no_show', 'transferred')
      )
  `).run(`-${retentionDays} days`);

  return { deleted: result.changes, retentionDays };
}
