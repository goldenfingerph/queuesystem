import { Router } from 'express';
import { getDb } from '../db/index.js';
import { broadcast } from '../ws/index.js';

export function servicesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT s.*, COUNT(cs.counter_id) AS assigned_counters
       FROM services s
       LEFT JOIN counter_services cs ON cs.service_id = s.id
       GROUP BY s.id ORDER BY s.name`,
    ).all();
    res.json({ services: rows });
  });

  router.post('/', (req, res) => {
    const { name, name_ar, code, description, prefix, avg_duration_sec, ticket_range_start, ticket_range_end } = req.body ?? {};
    const rangeStart = Number(ticket_range_start), rangeEnd = Number(ticket_range_end);
    const duration = avg_duration_sec === undefined ? 300 : Number(avg_duration_sec);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      res.status(400).json({ error: 'Service name must be 1–100 characters' }); return;
    }
    if (typeof name_ar !== 'string' || !name_ar.trim() || name_ar.trim().length > 150) {
      res.status(400).json({ error: 'Arabic service name is required and must be 150 characters or fewer' }); return;
    }
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(code)) {
      res.status(400).json({ error: 'Service code must be 2–12 letters, numbers, hyphens, or underscores' }); return;
    }
    if (typeof prefix !== 'string' || !prefix.trim() || prefix.trim().length > 12) {
      res.status(400).json({ error: 'Prefix is required and must be 12 characters or fewer' }); return;
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
      res.status(400).json({ error: 'Description must be 500 characters or fewer' }); return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 86400) {
      res.status(400).json({ error: 'Average duration must be between 1 and 86400 seconds' }); return;
    }
    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1000 || rangeEnd > 9999 || rangeStart > rangeEnd) {
      res.status(400).json({ error: 'Ticket range must be valid 4-digit numbers, with start not greater than end.' }); return;
    }
    const db = getDb();
    try {
      const createService = db.transaction(() => {
        const overlap = db.prepare('SELECT id FROM services WHERE NOT (ticket_range_end < ? OR ticket_range_start > ?)').get(rangeStart, rangeEnd);
        if (overlap) throw new Error('TICKET_RANGE_CONFLICT');
        const info = db.prepare(
          'INSERT INTO services (name, name_ar, code, description, prefix, avg_duration_sec, ticket_range_start, ticket_range_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(name.trim(), name_ar.trim(), code.toUpperCase(), description ?? '', prefix.trim(), duration, rangeStart, rangeEnd);
        db.prepare('INSERT INTO ticket_sequences (service_id, next_number) VALUES (?, 1)').run(info.lastInsertRowid);
        return Number(info.lastInsertRowid);
      });
      const id = createService();
      broadcast('services-updated', {});
      res.json({ status: 'ok', id });
    } catch (err) {
      if ((err as Error).message === 'TICKET_RANGE_CONFLICT') {
        res.status(409).json({ error: 'This ticket number range overlaps another service. Choose a different range.' });
      } else if ((err as Error).message.includes('UNIQUE')) {
        res.status(409).json({ error: 'Service code already exists' });
      } else {
        console.error('[services] create failed:', err);
        res.status(500).json({ error: 'Unable to create service due to a server error.' });
      }
    }
  });

  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { name, name_ar, code, description, prefix, avg_duration_sec, is_active, ticket_range_start, ticket_range_end } = req.body ?? {};
    const db = getDb();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (name !== undefined) { if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) { res.status(400).json({ error: 'Service name must be 1–100 characters' }); return; } sets.push('name = ?'); vals.push(name.trim()); }
    if (name_ar !== undefined) { if (typeof name_ar !== 'string' || !name_ar.trim() || name_ar.trim().length > 150) { res.status(400).json({ error: 'Arabic service name is required and must be 150 characters or fewer' }); return; } sets.push('name_ar = ?'); vals.push(name_ar.trim()); }
    if (code !== undefined) { if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(code)) { res.status(400).json({ error: 'Service code must be 2–12 letters, numbers, hyphens, or underscores' }); return; } sets.push('code = ?'); vals.push(code.toUpperCase()); }
    if (description !== undefined) { if (typeof description !== 'string' || description.length > 500) { res.status(400).json({ error: 'Description must be 500 characters or fewer' }); return; } sets.push('description = ?'); vals.push(description); }
    if (prefix !== undefined) { if (typeof prefix !== 'string' || !prefix.trim() || prefix.length > 12) { res.status(400).json({ error: 'Prefix is required and must be 12 characters or fewer' }); return; } sets.push('prefix = ?'); vals.push(prefix.trim()); }
    if (avg_duration_sec !== undefined) { if (!Number.isInteger(Number(avg_duration_sec)) || Number(avg_duration_sec) < 1 || Number(avg_duration_sec) > 86400) { res.status(400).json({ error: 'Average duration must be between 1 and 86400 seconds' }); return; } sets.push('avg_duration_sec = ?'); vals.push(Number(avg_duration_sec)); }
    if (is_active !== undefined) { if (![0, 1, true, false].includes(is_active)) { res.status(400).json({ error: 'Invalid active flag' }); return; } sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (ticket_range_start !== undefined || ticket_range_end !== undefined) {
      const current = db.prepare('SELECT ticket_range_start, ticket_range_end FROM services WHERE id = ?').get(id) as { ticket_range_start: number; ticket_range_end: number } | undefined;
      const start = Number(ticket_range_start ?? current?.ticket_range_start);
      const end = Number(ticket_range_end ?? current?.ticket_range_end);
      if (!current || !Number.isInteger(start) || !Number.isInteger(end) || start < 1000 || end > 9999 || start > end) { res.status(400).json({ error: 'Ticket range must be valid 4-digit numbers, with start not greater than end.' }); return; }
      sets.push('ticket_range_start = ?', 'ticket_range_end = ?'); vals.push(start, end);
    }
    if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    try {
      const updateService = db.transaction(() => {
        if (ticket_range_start !== undefined || ticket_range_end !== undefined) {
          const start = Number(ticket_range_start ?? (db.prepare('SELECT ticket_range_start FROM services WHERE id = ?').get(id) as { ticket_range_start: number } | undefined)?.ticket_range_start);
          const end = Number(ticket_range_end ?? (db.prepare('SELECT ticket_range_end FROM services WHERE id = ?').get(id) as { ticket_range_end: number } | undefined)?.ticket_range_end);
          const overlap = db.prepare('SELECT id FROM services WHERE id <> ? AND NOT (ticket_range_end < ? OR ticket_range_start > ?)').get(id, start, end);
          if (overlap) throw new Error('TICKET_RANGE_CONFLICT');
        }
        const result = db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        if (result.changes !== 1) throw new Error('SERVICE_NOT_FOUND');
      });
      updateService();
      broadcast('services-updated', {});
      res.json({ status: 'ok' });
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'TICKET_RANGE_CONFLICT') res.status(409).json({ error: 'This ticket number range overlaps another service. Choose a different range.' });
      else if (message === 'SERVICE_NOT_FOUND') res.status(404).json({ error: 'Service not found' });
      else if (message.includes('UNIQUE')) res.status(409).json({ error: 'Service code already exists' });
      else { console.error('[services] update failed:', err); res.status(500).json({ error: 'Unable to update service due to a server error.' }); }
    }
  });

  router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const db = getDb();
    const hasTickets = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE service_id = ?').get(id) as { n: number };
    if (hasTickets.n > 0) {
      res.status(409).json({ error: 'Cannot delete a service that has tickets. Disable it instead.' });
      return;
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    broadcast('services-updated', {});
    res.json({ status: 'ok' });
  });

  return router;
}
