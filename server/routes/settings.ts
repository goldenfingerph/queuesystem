import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireRole } from '../lib/middleware.js';

export function settingsRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM system_settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json({ settings });
  });

  router.put('/', requireRole('admin'), (req, res) => {
    const { settings } = req.body ?? {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      res.status(400).json({ error: 'settings object required' });
      return;
    }
    const allowedKeys = new Set(['ticket_padding', 'queue_mode', 'ads_enabled', 'ads_interval_sec', 'language', 'org_name_en', 'org_name_ar', 'tv_recent_calls', 'voice_enabled', 'bell_enabled', 'display_theme']);
    const entries = Object.entries(settings);
    if (entries.some(([key, value]) => !allowedKeys.has(key) || !['string', 'number', 'boolean'].includes(typeof value))) {
      res.status(400).json({ error: 'One or more settings are invalid or unsupported' }); return;
    }
    const numericInRange = (value: unknown, min: number, max: number) =>
      (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
      Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
    for (const key of ['ads_enabled', 'voice_enabled', 'bell_enabled']) {
      if (settings[key] !== undefined && !['0', '1', 0, 1, true, false].some((allowed) => allowed === settings[key])) {
        res.status(400).json({ error: `${key} must be 0 or 1` }); return;
      }
    }
    if (settings.queue_mode !== undefined && !['fifo', 'priority'].includes(String(settings.queue_mode))) {
      res.status(400).json({ error: 'queue_mode must be fifo or priority' }); return;
    }
    if (settings.language !== undefined && !['en', 'ar', 'both'].includes(String(settings.language))) {
      res.status(400).json({ error: 'language must be en, ar, or both' }); return;
    }
    if (settings.ticket_padding !== undefined && !numericInRange(settings.ticket_padding, 1, 8)) {
      res.status(400).json({ error: 'ticket_padding must be between 1 and 8' }); return;
    }
    if (settings.ads_interval_sec !== undefined && !numericInRange(settings.ads_interval_sec, 5, 360)) {
      res.status(400).json({ error: 'ads_interval_sec must be between 5 and 360' }); return;
    }
    if (settings.tv_recent_calls !== undefined && !numericInRange(settings.tv_recent_calls, 1, 20)) {
      res.status(400).json({ error: 'tv_recent_calls must be between 1 and 20' }); return;
    }
    for (const key of ['org_name_en', 'org_name_ar']) {
      if (settings[key] !== undefined && (typeof settings[key] !== 'string' || !String(settings[key]).trim() || String(settings[key]).length > 100)) {
        res.status(400).json({ error: `${key} must be 1 to 100 characters` }); return;
      }
    }
    if (settings.display_theme !== undefined && (typeof settings.display_theme !== 'string' || !/^[a-zA-Z0-9_-]{1,30}$/.test(settings.display_theme))) {
      res.status(400).json({ error: 'display_theme is invalid' }); return;
    }
    const db = getDb();
    const tx = db.transaction(() => {
      const stmt = db.prepare(
        "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      );
      for (const [key, value] of Object.entries(settings)) {
        stmt.run(key, String(value));
      }
    });
    tx();
    res.json({ status: 'ok' });
  });

  router.get('/visitor-categories', (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM visitor_categories ORDER BY sort_order').all();
    res.json({ categories: rows });
  });

  router.put('/visitor-categories/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { label_en, label_ar, priority_rank, is_active, sort_order } = req.body ?? {};
    if (!Number.isInteger(Number(id)) || Number(id) < 1) { res.status(400).json({ error: 'Invalid category ID' }); return; }
    if (label_en !== undefined && (typeof label_en !== 'string' || !label_en.trim() || label_en.length > 80)) { res.status(400).json({ error: 'English label is required and must be 80 characters or fewer' }); return; }
    if (label_ar !== undefined && (typeof label_ar !== 'string' || !label_ar.trim() || label_ar.length > 80)) { res.status(400).json({ error: 'Arabic label is required and must be 80 characters or fewer' }); return; }
    if (priority_rank !== undefined && (!Number.isInteger(priority_rank) || priority_rank < 1 || priority_rank > 99)) { res.status(400).json({ error: 'Priority rank must be an integer from 1 to 99' }); return; }
    if (is_active !== undefined && ![0, 1, true, false].includes(is_active)) { res.status(400).json({ error: 'Invalid active flag' }); return; }
    if (sort_order !== undefined && (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 999)) { res.status(400).json({ error: 'Sort order must be an integer from 0 to 999' }); return; }
    const db = getDb();
    if (!db.prepare('SELECT id FROM visitor_categories WHERE id = ?').get(Number(id))) {
      res.status(404).json({ error: 'Visitor category not found' }); return;
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (label_en !== undefined) { sets.push('label_en = ?'); vals.push(label_en); }
    if (label_ar !== undefined) { sets.push('label_ar = ?'); vals.push(label_ar); }
    if (priority_rank !== undefined) { sets.push('priority_rank = ?'); vals.push(priority_rank); }
    if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(sort_order); }
    if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    vals.push(id);
    db.prepare(`UPDATE visitor_categories SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ status: 'ok' });
  });

  return router;
}
