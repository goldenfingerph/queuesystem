import type { DB } from '../db/index.js';

export interface CreateServiceInput {
  name: string;
  name_ar: string;
  code: string;
  description?: string;
  prefix: string;
  avg_duration_sec: number;
  ticket_range_start: number;
  ticket_range_end: number;
}

export interface UpdateServiceInput {
  name?: string;
  name_ar?: string;
  code?: string;
  description?: string;
  prefix?: string;
  avg_duration_sec?: number;
  is_active?: boolean | 0 | 1;
  ticket_range_start?: number;
  ticket_range_end?: number;
}

export function listServices(db: DB): unknown[] {
  return db.prepare(
    `SELECT s.*, COUNT(cs.counter_id) AS assigned_counters
     FROM services s
     LEFT JOIN counter_services cs ON cs.service_id = s.id
     GROUP BY s.id ORDER BY s.name`,
  ).all();
}

export function createService(db: DB, input: CreateServiceInput): number {
  const create = db.transaction(() => {
    const overlap = db.prepare(
      'SELECT id FROM services WHERE NOT (ticket_range_end < ? OR ticket_range_start > ?)',
    ).get(input.ticket_range_start, input.ticket_range_end);
    if (overlap) throw new Error('TICKET_RANGE_CONFLICT');

    const info = db.prepare(
      'INSERT INTO services (name, name_ar, code, description, prefix, avg_duration_sec, ticket_range_start, ticket_range_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.name.trim(), input.name_ar.trim(), input.code.toUpperCase(),
      input.description ?? '', input.prefix.trim(), input.avg_duration_sec,
      input.ticket_range_start, input.ticket_range_end,
    );
    db.prepare('INSERT INTO ticket_sequences (service_id, next_number) VALUES (?, 1)').run(info.lastInsertRowid);
    return Number(info.lastInsertRowid);
  });
  return create();
}

export function updateService(db: DB, id: string, input: UpdateServiceInput): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name.trim()); }
  if (input.name_ar !== undefined) { sets.push('name_ar = ?'); values.push(input.name_ar.trim()); }
  if (input.code !== undefined) { sets.push('code = ?'); values.push(input.code.toUpperCase()); }
  if (input.description !== undefined) { sets.push('description = ?'); values.push(input.description); }
  if (input.prefix !== undefined) { sets.push('prefix = ?'); values.push(input.prefix.trim()); }
  if (input.avg_duration_sec !== undefined) { sets.push('avg_duration_sec = ?'); values.push(input.avg_duration_sec); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active ? 1 : 0); }

  const rangeChanged = input.ticket_range_start !== undefined || input.ticket_range_end !== undefined;
  if (rangeChanged) {
    const current = db.prepare(
      'SELECT ticket_range_start, ticket_range_end FROM services WHERE id = ?',
    ).get(id) as { ticket_range_start: number; ticket_range_end: number } | undefined;
    if (!current) throw new Error('SERVICE_NOT_FOUND');

    const start = input.ticket_range_start ?? current.ticket_range_start;
    const end = input.ticket_range_end ?? current.ticket_range_end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1000 || end > 9999 || start > end) {
      throw new Error('INVALID_TICKET_RANGE');
    }
    sets.push('ticket_range_start = ?', 'ticket_range_end = ?');
    values.push(start, end);
  }

  if (sets.length === 0) throw new Error('NO_FIELDS_TO_UPDATE');
  sets.push("updated_at = datetime('now')");
  values.push(id);

  const update = db.transaction(() => {
    if (rangeChanged) {
      const start = input.ticket_range_start ?? (db.prepare(
        'SELECT ticket_range_start FROM services WHERE id = ?',
      ).get(id) as { ticket_range_start: number }).ticket_range_start;
      const end = input.ticket_range_end ?? (db.prepare(
        'SELECT ticket_range_end FROM services WHERE id = ?',
      ).get(id) as { ticket_range_end: number }).ticket_range_end;
      const overlap = db.prepare(
        'SELECT id FROM services WHERE id <> ? AND NOT (ticket_range_end < ? OR ticket_range_start > ?)',
      ).get(id, start, end);
      if (overlap) throw new Error('TICKET_RANGE_CONFLICT');
    }

    const result = db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes !== 1) throw new Error('SERVICE_NOT_FOUND');
  });
  update();
}

export function deleteService(db: DB, id: string): void {
  const hasTickets = db.prepare(
    'SELECT COUNT(*) AS n FROM tickets WHERE service_id = ?',
  ).get(id) as { n: number };
  if (hasTickets.n > 0) throw new Error('SERVICE_HAS_TICKETS');
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}
