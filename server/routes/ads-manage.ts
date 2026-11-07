import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

const allowed = new Set(['.mp4', '.webm', '.ogg']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { fs.mkdirSync(config.adsDir, { recursive: true }); cb(null, config.adsDir); }
      catch (err) { cb(err as Error, ''); }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.has(ext)) { cb(new Error('Only MP4, WebM, and OGG video files are allowed'), ''); return; }
      cb(null, `ad-${randomUUID()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validMime = ['video/mp4', 'video/webm', 'video/ogg', 'application/ogg'].includes(file.mimetype);
    cb(null, allowed.has(ext) && validMime);
  },
  limits: { fileSize: 250 * 1024 * 1024, files: 1 },
});

export function adsManageRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const ads = getDb().prepare('SELECT id, filename, original_name, duration_sec, is_active, sort_order, created_at FROM ads ORDER BY sort_order, created_at').all();
    res.json({ ads });
  });

  router.post('/upload', (req, res, next) => {
    upload.single('video')(req, res, (err) => {
      if (err) { res.status(err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message }); return; }
      next();
    });
  }, (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'Choose a supported video file (MP4, WebM, or OGG)' }); return; }
    const duration = req.body.duration_sec === undefined || req.body.duration_sec === '' ? null : Number(req.body.duration_sec);
    if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 86400)) {
      fs.rmSync(req.file.path, { force: true });
      res.status(400).json({ error: 'Video duration must be between 0 and 86400 seconds' }); return;
    }
    try {
      const info = getDb().prepare(
        'INSERT INTO ads (filename, original_name, duration_sec, sort_order) VALUES (?, ?, ?, 0)',
      ).run(req.file.filename, path.basename(req.file.originalname).slice(0, 180), duration);
      res.json({ status: 'ok', id: info.lastInsertRowid, filename: req.file.filename });
    } catch {
      fs.rmSync(req.file.path, { force: true });
      res.status(500).json({ error: 'Could not save advertisement metadata' });
    }
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const { is_active, sort_order } = req.body ?? {};
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid advertisement ID' }); return; }
    if (is_active === undefined && sort_order === undefined) { res.status(400).json({ error: 'No fields to update' }); return; }
    if (is_active !== undefined && ![0, 1, true, false].includes(is_active)) { res.status(400).json({ error: 'Invalid active flag' }); return; }
    if (sort_order !== undefined && (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 10000)) { res.status(400).json({ error: 'Sort order must be 0–10000' }); return; }
    const sets: string[] = []; const vals: unknown[] = [];
    if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active ? 1 : 0); }
    if (sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(sort_order); }
    vals.push(id);
    const result = getDb().prepare(`UPDATE ads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    if (!result.changes) { res.status(404).json({ error: 'Advertisement not found' }); return; }
    res.json({ status: 'ok' });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid advertisement ID' }); return; }
    const db = getDb();
    const ad = db.prepare('SELECT filename FROM ads WHERE id = ?').get(id) as { filename: string } | undefined;
    if (!ad) { res.status(404).json({ error: 'Advertisement not found' }); return; }
    if (path.basename(ad.filename) !== ad.filename || !/^ad-[a-f0-9-]+\.(mp4|webm|ogg)$/.test(ad.filename)) {
      res.status(500).json({ error: 'Stored advertisement filename is invalid' }); return;
    }
    db.prepare('DELETE FROM ads WHERE id = ?').run(id);
    const file = path.resolve(config.adsDir, ad.filename);
    if (file.startsWith(path.resolve(config.adsDir) + path.sep)) fs.rmSync(file, { force: true });
    res.json({ status: 'ok' });
  });

  return router;
}
