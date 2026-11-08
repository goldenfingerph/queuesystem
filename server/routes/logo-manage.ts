import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { hasSupportedFileSignature } from '../lib/upload-validation.js';

const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { fs.mkdirSync(config.logoDir, { recursive: true }); cb(null, config.logoDir); }
      catch (err) { cb(err as Error, ''); }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.has(ext)) { cb(new Error('Only PNG, JPG, and WebP images are allowed'), ''); return; }
      cb(null, `logo-${randomUUID()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validMime = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(null, allowed.has(ext) && validMime);
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
});

export function logoManageRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const row = getDb().prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() as { value: string } | undefined;
    res.json({ logoUrl: row?.value ? '/api/media/logo/current' : null });
  });

  router.post('/upload', (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
      if (err) {
        const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400)
          .json({ error: tooLarge ? 'Logo must be 5 MB or smaller' : 'Invalid logo upload request' });
        return;
      }
      next();
    });
  }, (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'Choose a PNG, JPG, or WebP image' }); return; }
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (!hasSupportedFileSignature(req.file.path, 'image', extension)) {
      fs.rmSync(req.file.path, { force: true });
      res.status(400).json({ error: 'The image content does not match its file extension' }); return;
    }
    const db = getDb();
    const previous = db.prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() as { value: string } | undefined;
    db.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES ('logo_filename', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(req.file.filename);
    if (previous?.value && previous.value !== req.file.filename && previous.value === path.basename(previous.value) && /^logo-[a-f0-9-]+\.(png|jpg|jpeg|webp)$/.test(previous.value)) {
      fs.rmSync(path.resolve(config.logoDir, previous.value), { force: true });
    }
    res.json({ status: 'ok', logoUrl: '/api/media/logo/current' });
  });

  router.delete('/', (_req, res) => {
    const db = getDb();
    const previous = db.prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() as { value: string } | undefined;
    db.prepare("DELETE FROM system_settings WHERE key = 'logo_filename'").run();
    if (previous?.value && previous.value === path.basename(previous.value) && /^logo-[a-f0-9-]+\.(png|jpg|jpeg|webp)$/.test(previous.value)) {
      fs.rmSync(path.resolve(config.logoDir, previous.value), { force: true });
    }
    res.json({ status: 'ok', logoUrl: null });
  });

  return router;
}
