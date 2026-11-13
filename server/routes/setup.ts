import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hashPassword } from '../lib/auth.js';
import { createSession, type AuthUser } from '../lib/middleware.js';

export function setupRouter(): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const row = getDb().prepare('SELECT completed FROM setup_state WHERE id = 1').get() as { completed: number } | undefined;
    res.json({ required: row?.completed !== 1 });
  });

  router.post('/complete', (req, res) => {
    const { organizationNameEn, organizationNameAr, username, displayName, password, language, businessTimezone, businessDayStart } = req.body ?? {};
    const validText = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    if (!validText(organizationNameEn, 100) || !validText(organizationNameAr, 100) ||
        !validText(displayName, 80) || typeof username !== 'string' ||
        !/^[a-zA-Z0-9._-]{3,32}$/.test(username) ||
        typeof password !== 'string' || password.length < 12 || password.length > 200 ||
        !['en', 'ar', 'both'].includes(language) ||
        typeof businessTimezone !== 'string' || businessTimezone.length > 80 ||
        typeof businessDayStart !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(businessDayStart)) {
      res.status(400).json({ error: 'Please provide valid company names, admin details, a 12–200 character password, language, timezone, and business-day start.' });
      return;
    }

    try { new Intl.DateTimeFormat('en-US', { timeZone: businessTimezone }); }
    catch { res.status(400).json({ error: 'Please provide a valid IANA timezone.' }); return; }

    const db = getDb();
    const state = db.prepare('SELECT completed FROM setup_state WHERE id = 1').get() as { completed: number } | undefined;
    if (!state || state.completed !== 0) {
      res.status(409).json({ error: 'Initial setup has already been completed.' });
      return;
    }
    if (db.prepare('SELECT id FROM users WHERE username = ? AND id <> (SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1)').get(username, 'admin')) {
      res.status(409).json({ error: 'That username is already in use.' });
      return;
    }

    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (!admin) {
      res.status(500).json({ error: 'The initial administrator account is missing. Contact support.' });
      return;
    }

    const complete = db.transaction(() => {
      db.prepare("UPDATE users SET username = ?, password_hash = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(username, hashPassword(password), displayName.trim(), admin.id);
      const setting = db.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
      setting.run('org_name_en', organizationNameEn.trim());
      setting.run('org_name_ar', organizationNameAr.trim());
      setting.run('language', language);
      setting.run('business_timezone', businessTimezone);
      setting.run('business_day_start', businessDayStart);
      db.prepare("UPDATE setup_state SET completed = 1, completed_at = datetime('now') WHERE id = 1 AND completed = 0").run();
    });
    try {
      complete();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users.username/.test(error.message)) {
        res.status(409).json({ error: 'That username is already in use.' });
        return;
      }
      throw error;
    }

    const user: AuthUser = { id: admin.id, username, display_name: displayName.trim(), role: 'admin' };
    res.status(201).json({ token: createSession(admin.id), user });
  });

  return router;
}
