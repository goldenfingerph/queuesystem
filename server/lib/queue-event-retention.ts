import type Database from 'better-sqlite3';

/**
 * Remove aged queue-event audit rows while retaining every ticket record,
 * all events for active tickets, and the final event for each terminal ticket.
 * The cutoff is based on the ticket's business date, not the host timezone.
 */
export function pruneQueueEvents(
  db: Database.Database,
  retentionDays: number,
  now: Date = new Date(),
): number {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
    throw new Error('Queue event retention must be an integer from 30 to 3650 days.');
  }
  if (!Number.isFinite(now.getTime())) throw new Error('A valid current date is required.');

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffBusinessDate = cutoff.toISOString().slice(0, 10);
  const cutoffTimestamp = cutoff.toISOString().replace('T', ' ').slice(0, 19);

  const result = db.prepare(`
    DELETE FROM queue_events
    WHERE id IN (
      SELECT qe.id
      FROM queue_events qe
      INNER JOIN tickets t ON t.id = qe.ticket_id
      WHERE t.status IN ('completed', 'no_show', 'transferred')
        AND t.business_date < ?
        AND qe.created_at < ?
        AND qe.id < (
          SELECT MAX(latest.id)
          FROM queue_events latest
          WHERE latest.ticket_id = qe.ticket_id
        )
    )
  `).run(cutoffBusinessDate, cutoffTimestamp);

  return result.changes;
}
