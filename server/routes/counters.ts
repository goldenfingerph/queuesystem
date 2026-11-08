import { Router } from 'express';
import { getDb } from '../db/index.js';
import { broadcast } from '../ws/index.js';
import { requireRole } from '../lib/middleware.js';

export function countersRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT c.*,
        GROUP_CONCAT(cs.service_id) AS service_ids,
        (SELECT sa.user_id FROM staff_assignments sa
         WHERE sa.counter_id = c.id AND sa.status = 'active' LIMIT 1) AS active_user_id
       FROM counters c
       LEFT JOIN counter_services cs ON cs.counter_id = c.id
       GROUP BY c.id ORDER BY c.number`,
    ).all() as (Record<string, unknown> & { service_ids: string | null })[];
    const counters = rows.map((r) => ({
      ...r,
      service_ids: r.service_ids ? r.service_ids.split(',').map(Number) : [],
    }));
    res.json({ counters });
  });

  router.post('/', requireRole('admin'), (req, res) => {
    const { number, name } = req.body ?? {};
    if (!Number.isInteger(Number(number)) || Number(number) < 1 || typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
      res.status(400).json({ error: 'Number and name are required' });
      return;
    }
    const db = getDb();
    try {
      const info = db.prepare('INSERT INTO counters (number, name) VALUES (?, ?)').run(Number(number), name.trim());
      broadcast('counters-updated', {});
      res.json({ status: 'ok', id: info.lastInsertRowid });
    } catch (err) {
      if ((err as Error).message.includes('UNIQUE')) {
        res.status(409).json({ error: 'Counter number already exists' });
      } else {
        console.error('[counters] create failed:', err);
        res.status(500).json({ error: 'Unable to create counter' });
      }
    }
  });

  router.put('/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { number, name, is_active } = req.body ?? {};
    if (!Number.isInteger(Number(id)) || Number(id) < 1) { res.status(400).json({ error: 'Invalid counter ID' }); return; }
    if (number !== undefined && (!Number.isInteger(Number(number)) || Number(number) < 1)) { res.status(400).json({ error: 'Counter number must be a positive integer' }); return; }
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 60)) { res.status(400).json({ error: 'Counter name is required and must be 60 characters or fewer' }); return; }
    if (is_active !== undefined && ![0, 1, true, false].includes(is_active as number | boolean)) { res.status(400).json({ error: 'Invalid active flag' }); return; }
    if (is_active !== undefined && typeof is_active !== 'boolean' && ![0, 1].includes(is_active)) { res.status(400).json({ error: 'Invalid active flag' }); return; }
    const db = getDb();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (number !== undefined) { sets.push('number = ?'); vals.push(number); }
    if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
    if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    try {
      // Serialize the usage check and update with ticket transfers/calls so a
      // counter cannot be disabled while it has a pinned waiting ticket.
      const updateCounter = db.transaction(() => {
        if (!db.prepare('SELECT id FROM counters WHERE id = ?').get(Number(id))) return 'not-found';
        if (is_active === false || is_active === 0) {
          const inUse = db.prepare(
            `SELECT
               (SELECT COUNT(*) FROM staff_assignments WHERE counter_id = ? AND status IN ('active', 'break')) +
               (SELECT COUNT(*) FROM tickets WHERE counter_id = ? AND status IN ('called', 'serving')) +
               (SELECT COUNT(*) FROM tickets WHERE queued_for_counter_id = ? AND status = 'waiting') AS n`,
          ).get(Number(id), Number(id), Number(id)) as { n: number };
          if (inUse.n > 0) return 'in-use';
        }
        const result = db.prepare(`UPDATE counters SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        return result.changes === 1 ? 'ok' : 'not-found';
      });
      const outcome = updateCounter.immediate();
      if (outcome === 'not-found') { res.status(404).json({ error: 'Counter not found' }); return; }
      if (outcome === 'in-use') {
        res.status(409).json({ error: 'Cannot disable a counter while staff are assigned, a ticket is being served, or a transferred ticket is waiting for it. End the assignment or move the waiting ticket first.' });
        return;
      }
      broadcast('counters-updated', {});
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('[counters] update failed:', err);
      res.status(500).json({ error: 'Unable to update counter' });
    }
  });

  router.delete('/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const db = getDb();
    if (!Number.isInteger(Number(id)) || Number(id) < 1) { res.status(400).json({ error: 'Invalid counter ID' }); return; }
    const exists = db.prepare('SELECT id FROM counters WHERE id = ?').get(Number(id));
    if (!exists) { res.status(404).json({ error: 'Counter not found' }); return; }
    const history = db.prepare(
      `SELECT (SELECT COUNT(*) FROM tickets WHERE counter_id = ?) +
              (SELECT COUNT(*) FROM queue_events WHERE counter_id = ?) +
              (SELECT COUNT(*) FROM staff_assignments WHERE counter_id = ?) AS n`,
    ).get(id, id, id) as { n: number };
    if (history.n > 0) {
      res.status(409).json({ error: 'Cannot delete a counter with ticket or staff history. Disable it instead.' });
      return;
    }
    db.prepare('DELETE FROM counters WHERE id = ?').run(id);
    broadcast('counters-updated', {});
    res.json({ status: 'ok' });
  });

  // Assign services to a counter (replaces all)
  router.put('/:id/services', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { serviceIds } = req.body ?? {};
    if (!Array.isArray(serviceIds) || serviceIds.length > 200) { res.status(400).json({ error: 'serviceIds must be an array of at most 200 items' }); return; }
    if (!Number.isInteger(Number(id)) || Number(id) < 1 || serviceIds.some((sid: unknown) => !Number.isInteger(Number(sid)) || Number(sid) < 1)) { res.status(400).json({ error: 'Invalid counter or service ID' }); return; }
    if (new Set(serviceIds.map(Number)).size !== serviceIds.length) { res.status(400).json({ error: 'Duplicate service IDs are not allowed' }); return; }
    const db = getDb();
    const exists = db.prepare('SELECT id FROM counters WHERE id = ?').get(Number(id));
    if (!exists) { res.status(404).json({ error: 'Counter not found' }); return; }
    const validCount = db.prepare(`SELECT COUNT(*) AS n FROM services WHERE is_active = 1 AND id IN (${serviceIds.map(() => '?').join(',') || 'NULL'})`).get(...serviceIds) as { n: number };
    if (validCount.n !== new Set(serviceIds.map(Number)).size) { res.status(400).json({ error: 'One or more services are invalid or inactive' }); return; }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM counter_services WHERE counter_id = ?').run(id);
      const stmt = db.prepare('INSERT INTO counter_services (counter_id, service_id) VALUES (?, ?)');
      for (const sid of serviceIds) stmt.run(id, sid);
    });
    try { tx(); } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'Could not update counter services' });
      return;
    }
    broadcast('counters-updated', {});
    res.json({ status: 'ok' });
  });

  return router;
}
