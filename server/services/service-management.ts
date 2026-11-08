import { getDb } from '../db/index.js';

export type ServiceInput = {
  name?: unknown;
  name_ar?: unknown;
  code?: unknown;
  description?: unknown;
  prefix?: unknown;
  avg_duration_sec?: unknown;
  is_active?: unknown;
  ticket_range_start?: unknown;
  ticket_range_end?: unknown;
};

export class ServiceManagementError extends Error {
  constructor(
    public readonly code: 'VALIDATION' | 'RANGE_CONFLICT' | 'DUPLICATE_CODE' | 'NOT_FOUND' | 'HAS_TICKETS',
    message: string,
  ) {
    super(message);
    this.name = 'ServiceManagementError';
  }
}

function validateName(value: unknown, field: 'name' | 'name_ar'): string {
  const max = field === 'name' ? 100 : 150;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ServiceManagementError('VALIDATION', field === 'name'
      ? 'Service name must be 1–100 characters'
      : 'Arabic service name is required and must be 150 characters or fewer');
  }
  return value.trim();
}

function validateRange(startValue: unknown, endValue: unknown): { start: number; end: number } {
  const start = Number(startValue);
  const end = Number(endValue);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1000 || end > 9999 || start > end) {
    throw new ServiceManagementError('VALIDATION', 'Ticket range must be valid 4-digit numbers, with start not greater than end.');
  }
  return { start, end };
}

export function listServices() {
  return getDb().prepare(
    `SELECT s.*, COUNT(cs.counter_id) AS assigned_counters
     FROM services s
     LEFT JOIN counter_services cs ON cs.service_id = s.id
     GROUP BY s.id ORDER BY s.name`,
  ).all();
}

export function createService(input: ServiceInput): number {
  const name = validateName(input.name, 'name');
  const nameAr = validateName(input.name_ar, 'name_ar');
  if (typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(input.code)) {
    throw new ServiceManagementError('VALIDATION', 'Service code must be 2–12 letters, numbers, hyphens, or underscores');
  }
  if (typeof input.prefix !== 'string' || !input.prefix.trim() || input.prefix.trim().length > 12) {
    throw new ServiceManagementError('VALIDATION', 'Prefix is required and must be 12 characters or fewer');
  }
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 500)) {
    throw new ServiceManagementError('VALIDATION', 'Description must be 500 characters or fewer');
  }
  const duration = input.avg_duration_sec === undefined ? 300 : Number(input.avg_duration_sec);
  if (!Number.isInteger(duration) || duration < 1 || duration > 86400) {
    throw new ServiceManagementError('VALIDATION', 'Average duration must be between 1 and 86400 seconds');
  }
  const { start, end } = validateRange(input.ticket_range_start, input.ticket_range_end);
  const db = getDb();
  try {
    return Number(db.transaction(() => {
      const overlap = db.prepare(
        'SELECT id FROM services WHERE NOT (ticket_range_end < ? OR ticket_range_start > ?)',
      ).get(start, end);
      if (overlap) throw new ServiceManagementError('RANGE_CONFLICT', 'This ticket number range overlaps another service. Choose a different range.');
      const info = db.prepare(
        'INSERT INTO services (name, name_ar, code, description, prefix, avg_duration_sec, ticket_range_start, ticket_range_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(name, nameAr, (input.code as string).toUpperCase(), input.description ?? '', input.prefix.trim(), duration, start, end);
      db.prepare('INSERT INTO ticket_sequences (service_id, next_number) VALUES (?, 1)').run(info.lastInsertRowid);
      return info.lastInsertRowid;
    })());
  } catch (error) {
    if (error instanceof ServiceManagementError) throw error;
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw new ServiceManagementError('DUPLICATE_CODE', 'Service code already exists');
    }
    throw error;
  }
}

export function updateService(id: number, input: ServiceInput): void {
  if (!Number.isInteger(id) || id < 1) throw new ServiceManagementError('VALIDATION', 'Invalid service ID');
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(validateName(input.name, 'name')); }
  if (input.name_ar !== undefined) { sets.push('name_ar = ?'); values.push(validateName(input.name_ar, 'name_ar')); }
  if (input.code !== undefined) {
    if (typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(input.code)) throw new ServiceManagementError('VALIDATION', 'Service code must be 2–12 letters, numbers, hyphens, or underscores');
    sets.push('code = ?'); values.push(input.code.toUpperCase());
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string' || input.description.length > 500) throw new ServiceManagementError('VALIDATION', 'Description must be 500 characters or fewer');
    sets.push('description = ?'); values.push(input.description);
  }
  if (input.prefix !== undefined) {
    if (typeof input.prefix !== 'string' || !input.prefix.trim() || input.prefix.trim().length > 12) throw new ServiceManagementError('VALIDATION', 'Prefix is required and must be 12 characters or fewer');
    sets.push('prefix = ?'); values.push(input.prefix.trim());
  }
  if (input.avg_duration_sec !== undefined) {
    const duration = Number(input.avg_duration_sec);
    if (!Number.isInteger(duration) || duration < 1 || duration > 86400) throw new ServiceManagementError('VALIDATION', 'Average duration must be between 1 and 86400 seconds');
    sets.push('avg_duration_sec = ?'); values.push(duration);
  }
  if (input.is_active !== undefined) {
    if (![0, 1, true, false].includes(input.is_active as number | boolean)) throw new ServiceManagementError('VALIDATION', 'Invalid active flag');
    sets.push('is_active = ?'); values.push(input.is_active ? 1 : 0);
  }

  const rangeChanged = input.ticket_range_start !== undefined || input.ticket_range_end !== undefined;
  if (rangeChanged) {
    const current = db.prepare('SELECT ticket_range_start, ticket_range_end FROM services WHERE id = ?').get(id) as { ticket_range_start: number; ticket_range_end: number } | undefined;
    if (!current) throw new ServiceManagementError('NOT_FOUND', 'Service not found');
    const { start, end } = validateRange(input.ticket_range_start ?? current.ticket_range_start, input.ticket_range_end ?? current.ticket_range_end);
    sets.push('ticket_range_start = ?', 'ticket_range_end = ?'); values.push(start, end);
  }
  if (sets.length === 0) throw new ServiceManagementError('VALIDATION', 'No fields to update');
  sets.push("updated_at = datetime('now')");
  values.push(id);

  try {
    db.transaction(() => {
      if (rangeChanged) {
        const current = db.prepare('SELECT ticket_range_start, ticket_range_end FROM services WHERE id = ?').get(id) as { ticket_range_start: number; ticket_range_end: number } | undefined;
        if (!current) throw new ServiceManagementError('NOT_FOUND', 'Service not found');
        const start = Number(input.ticket_range_start ?? current.ticket_range_start);
        const end = Number(input.ticket_range_end ?? current.ticket_range_end);
        const overlap = db.prepare(
          'SELECT id FROM services WHERE id <> ? AND NOT (ticket_range_end < ? OR ticket_range_start > ?)',
        ).get(id, start, end);
        if (overlap) throw new ServiceManagementError('RANGE_CONFLICT', 'This ticket number range overlaps another service. Choose a different range.');
      }
      const result = db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (result.changes !== 1) throw new ServiceManagementError('NOT_FOUND', 'Service not found');
    })();
  } catch (error) {
    if (error instanceof ServiceManagementError) throw error;
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ServiceManagementError('DUPLICATE_CODE', 'Service code already exists');
    throw error;
  }
}

export function deleteService(id: number): void {
  if (!Number.isInteger(id) || id < 1) throw new ServiceManagementError('VALIDATION', 'Invalid service ID');
  const db = getDb();
  const outcome = db.transaction(() => {
    const exists = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
    if (!exists) return 'not-found';
    const hasTickets = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE service_id = ?').get(id) as { n: number };
    if (hasTickets.n > 0) return 'has-tickets';
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    return 'ok';
  }).immediate();
  if (outcome === 'not-found') throw new ServiceManagementError('NOT_FOUND', 'Service not found');
  if (outcome === 'has-tickets') throw new ServiceManagementError('HAS_TICKETS', 'Cannot delete a service that has tickets. Disable it instead.');
}
