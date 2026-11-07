import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

export function adsRouter(): Router {
  const router = Router();
  fs.mkdirSync(config.adsDir, { recursive: true });
  const root = path.resolve(config.adsDir);
  fs.mkdirSync(config.logoDir, { recursive: true });
  const logoRoot = path.resolve(config.logoDir);

  router.get('/logo/current', (_req, res) => {
    const row = getDb().prepare("SELECT value FROM system_settings WHERE key = 'logo_filename'").get() as { value: string } | undefined;
    const filename = row?.value;
    if (!filename || filename !== path.basename(filename) || !/^logo-[a-f0-9-]+\.(png|jpg|jpeg|webp)$/.test(filename)) {
      res.status(404).end(); return;
    }
    const file = path.resolve(logoRoot, filename);
    fs.stat(file, (err, stat) => {
      if (err || !stat?.isFile()) { res.status(404).end(); return; }
      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.set({ 'Content-Type': contentType, 'Content-Length': String(stat.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(file).pipe(res);
    });
  });

  router.get('/ads/:filename', (req, res) => {
    const filename = req.params.filename;
    if (filename !== path.basename(filename) || !/^ad-[a-f0-9-]+\.(mp4|webm|ogg)$/.test(filename)) {
      res.status(400).json({ error: 'Invalid advertisement filename' }); return;
    }
    const file = path.resolve(root, filename);
    if (!file.startsWith(root + path.sep)) { res.status(400).json({ error: 'Invalid path' }); return; }

    fs.stat(file, (err, stat) => {
      if (err || !stat?.isFile()) { res.status(404).json({ error: 'Advertisement not found' }); return; }

      // Explicit byte-range support makes browser video seeking and progressive
      // playback reliable, including on Chrome-based TV displays.
      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : 'video/ogg';
      const range = req.headers.range;
      res.set({
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
          res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        const end = match[2] && match[1] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
          res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        res.status(206).set({
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }

      res.set('Content-Length', String(stat.size));
      fs.createReadStream(file).pipe(res);
    });
  });

  return router;
}
