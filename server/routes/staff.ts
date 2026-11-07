import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hashPassword } from '../lib/auth.js';
import { broadcast } from '../ws/index.js';

const roles = ['admin', 'senior_clerk', 'service_officer', 'receptionist'];

export function staffRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = getDb().prepare(
      `SELECT id, username, display_name, role, is_active, created_at, updated_at
       FROM users ORDER BY display_name`,
    ).all();
    res.json({ staff: rows });
  });

  router.get('/assignments', (_req, res) => {
    const rows = getDb().prepare(
      `SELECT sa.id, sa.user_id, sa.counter_id, sa.status, sa.started_at, sa.ended_at,
              u.display_name, u.username, c.number AS counter_number, c.name AS counter_name
       FROM staff_assignments sa JOIN users u ON u.id = sa.user_id
       JOIN counters c ON c.id = sa.counter_id
       ORDER BY sa.started_at DESC LIMIT 300`,
    ).all();
    res.json({ assignments: rows });
  });

  router.post('/assignments', (req, res) => {
    const { user_id, counter_id } = req.body ?? {};
    if (!Number.isInteger(Number(user_id)) || Number(user_id) < 1 ||
        !Number.isInteger(Number(counter_id)) || Number(counter_id) < 1) {
      res.status(400).json({ error: 'Valid staff and counter IDs are required' }); return;
    }
    const db = getDb();
    const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND is_active = 1').get(user_id) as { id: number; role: string } | undefined;
    const counter = db.prepare('SELECT id FROM counters WHERE id = ? AND is_active = 1').get(counter_id);
    if (!user || !counter) { res.status(404).json({ error: 'Active staff member or counter not found' }); return; }
    if (user.role !== 'service_officer') { res.status(400).json({ error: 'Only service officers can be assigned to service counters' }); return; }
    const tx = db.transaction(() => {
      const occupied = db.prepare("SELECT id FROM staff_assignments WHERE counter_id = ? AND status = 'active'").get(counter_id);
      if (occupied) throw new Error('Counter already has an active staff assignment');
      db.prepare("UPDATE staff_assignments SET status = 'ended', ended_at = datetime('now') WHERE user_id = ? AND status IN ('active', 'break')").run(user_id);
      const info = db.prepare("INSERT INTO staff_assignments (user_id, counter_id, status) VALUES (?, ?, 'active')").run(user_id, counter_id);
      return info.lastInsertRowid;
    });
    try {
      const id = tx();
      broadcast('counters-updated', {});
      res.json({ status: 'ok', id });
    } catch (err) { res.status(409).json({ error: err instanceof Error ? err.message : 'Assignment failed' }); }
  });

  router.put('/assignments/:id', (req, res) => {
    const { status } = req.body ?? {};
    if (!['break', 'ended', 'active'].includes(status)) { res.status(400).json({ error: 'Status must be active, break, or ended' }); return; }
    const db = getDb();
    const assignment = db.prepare('SELECT id, user_id, counter_id, status FROM staff_assignments WHERE id = ?').get(req.params.id) as { id: number; user_id: number; counter_id: number; status: string } | undefined;
    if (!assignment) { res.status(404).json({ error: 'Assignment not found' }); return; }
    const updateAssignment = db.transaction(() => {
      if (status === 'active') {
        const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND is_active = 1').get(assignment.user_id) as { id: number; role: string } | undefined;
        const counter = db.prepare('SELECT id FROM counters WHERE id = ? AND is_active = 1').get(assignment.counter_id);
        if (!user || !counter) throw new Error('Staff member or counter is inactive');
        if (user.role !== 'service_officer') throw new Error('Only service officers can be assigned to service counters');
        const occupiedCounter = db.prepare("SELECT id FROM staff_assignments WHERE counter_id = ? AND status = 'active' AND id <> ?").get(assignment.counter_id, assignment.id);
        if (occupiedCounter) throw new Error('Counter already has another active staff member');
        const occupiedUser = db.prepare("SELECT id FROM staff_assignments WHERE user_id = ? AND status = 'active' AND id <> ?").get(assignment.user_id, assignment.id);
        if (occupiedUser) throw new Error('Staff member already has an active counter assignment');
      }
      db.prepare("UPDATE staff_assignments SET status = ?, ended_at = CASE WHEN ? = 'ended' THEN datetime('now') ELSE NULL END WHERE id = ?").run(status, status, assignment.id);
    });
    try {
      updateAssignment();
      broadcast('counters-updated', {});
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'Unable to update assignment' });
    }
  });

  router.post('/', (req, res) => {
    const { username, password, display_name, role } = req.body ?? {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(username) ||
        typeof display_name !== 'string' || !display_name.trim() || display_name.trim().length > 80 ||
        typeof password !== 'string' || password.length < 12 || password.length > 200 ||
        !roles.includes(role)) {
      res.status(400).json({ error: 'Enter a valid username, display name, role, and password (at least 12 characters)' }); return;
    }
    try {
      getDb().prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
        .run(username, hashPassword(password), display_name.trim(), role);
      broadcast('staff-updated', {});
      res.json({ status: 'ok' });
    } catch (err) {
      if ((err as Error).message.includes('UNIQUE')) res.status(409).json({ error: 'Username already exists' });
      else res.status(500).json({ error: 'Unable to create staff account' });
    }
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const { display_name, role, is_active, password } = req.body ?? {};
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid staff ID' }); return; }
    if (display_name !== undefined && (typeof display_name !== 'string' || !display_name.trim() || display_name.trim().length > 80)) { res.status(400).json({ error: 'Display name must be 1–80 characters' }); return; }
    if (role !== undefined && !roles.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    if (is_active !== undefined && ![0, 1, true, false].includes(is_active)) { res.status(400).json({ error: 'Invalid active flag' }); return; }
    if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 200)) { res.status(400).json({ error: 'Password must be at least 12 characters' }); return; }
    const db = getDb();
    const target = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(id) as { id: number; role: string; is_active: number } | undefined;
    if (!target) { res.status(404).json({ error: 'Staff account not found' }); return; }
    const nextRole = role ?? target.role;
    const nextActive = is_active === undefined ? target.is_active : (is_active ? 1 : 0);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (display_name !== undefined) { sets.push('display_name = ?'); vals.push(display_name.trim()); }
    if (role !== undefined) { sets.push('role = ?'); vals.push(role); }
    if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (password) { sets.push('password_hash = ?'); vals.push(hashPassword(password)); }
    if (!sets.length) { res.status(400).json({ error: 'No fields to update' }); return; }
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    try {
      const updateStaff = db.transaction(() => {
        if (target.role === 'admin' && target.is_active && (nextRole !== 'admin' || !nextActive)) {
          const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get() as { n: number };
          if (count.n <= 1) throw new Error('LAST_ACTIVE_ADMIN');
        }
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        if (!nextActive) {
          db.prepare("UPDATE sessions SET expires_at = datetime('now') WHERE user_id = ?").run(id);
          db.prepare("UPDATE staff_assignments SET status = 'ended', ended_at = datetime('now') WHERE user_id = ? AND status IN ('active','break')").run(id);
        }
      });
      updateStaff();
    } catch (err) {
      if (err instanceof Error && err.message === 'LAST_ACTIVE_ADMIN') {
        res.status(409).json({ error: 'Cannot deactivate or demote the last active administrator' });
        return;
      }
      res.status(500).json({ error: 'Unable to update staff account' });
      return;
    }
    broadcast('staff-updated', {});
    broadcast('counters-updated', {});
    res.json({ status: 'ok' });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid staff ID' }); return; }
    if (req.user?.id === id) { res.status(409).json({ error: 'You cannot delete your own account while signed in' }); return; }
    const db = getDb();
    const target = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(id) as { role: string; is_active: number } | undefined;
    if (!target) { res.status(404).json({ error: 'Staff account not found' }); return; }
    const history = db.prepare('SELECT 1 FROM staff_assignments WHERE user_id = ? LIMIT 1').get(id);
    if (history) {
      res.status(409).json({ error: 'This staff account has assignment history. Deactivate it instead of deleting it to preserve records.' });
      return;
    }
    if (target.role === 'admin' && target.is_active) {
      const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get() as { n: number };
      if (count.n <= 1) { res.status(409).json({ error: 'Cannot delete the last active administrator' }); return; }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    broadcast('staff-updated', {});
    res.json({ status: 'ok' });
  });

  return router;
}
