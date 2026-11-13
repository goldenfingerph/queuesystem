import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { rotateBackups } from '../lib/backup-retention.js';
import { writeAuditLog } from '../lib/audit-log.js';

const BACKUP_RETENTION_COUNT = 30;

export function backupRouter(): Router {
  const router = Router();

  router.post('/backup', async (req, res) => {
    let dest = '';
    try {
      fs.mkdirSync(config.backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `queuesystem-backup-${stamp}.db`;
      dest = path.join(config.backupsDir, filename);
      const db = getDb();
      await db.backup(dest);
      const stat = fs.statSync(dest);
      db.prepare('INSERT INTO backups (filename, size_bytes, created_by) VALUES (?, ?, ?)')
        .run(filename, stat.size, req.user?.id ?? null);

      // Rotation runs only after the new backup and its metadata are safely
      // written. Failures pruning older files never invalidate this backup.
      const rotated = rotateBackups(db, config.backupsDir, BACKUP_RETENTION_COUNT);
      writeAuditLog(db, {
        actorUserId: req.user!.id, actorUsername: req.user!.username, ipAddress: req.socket.remoteAddress,
        action: 'backup.created', targetType: 'backup', targetId: filename,
        details: { sizeBytes: stat.size, rotated },
      });
      res.json({ status: 'ok', filename, sizeBytes: stat.size, retentionCount: BACKUP_RETENTION_COUNT, rotated });
    } catch (err) {
      if (dest && fs.existsSync(dest)) fs.rmSync(dest, { force: true });
      res.status(500).json({ status: 'error', message: err instanceof Error ? err.message : 'backup failed' });
    }
  });

  router.get('/backups', (_req, res) => {
    try {
      const rows = getDb().prepare(
        'SELECT id, filename, size_bytes, created_at FROM backups ORDER BY created_at DESC, id DESC',
      ).all();
      res.json({ status: 'ok', backups: rows });
    } catch (err) {
      res.status(500).json({ status: 'error', message: err instanceof Error ? err.message : 'list failed' });
    }
  });

  router.get('/backups/:id/download', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid backup ID' }); return; }
    const row = getDb().prepare('SELECT filename FROM backups WHERE id = ?').get(id) as { filename: string } | undefined;
    if (!row || path.basename(row.filename) !== row.filename || !/^(?:queuesystem|infinity)-backup-[\dTZ-]+\.db$/.test(row.filename)) {
      res.status(404).json({ error: 'Backup not found' }); return;
    }
    const file = path.resolve(config.backupsDir, row.filename);
    if (!file.startsWith(path.resolve(config.backupsDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.status(404).json({ error: 'Backup file not found' }); return;
    }
    writeAuditLog(getDb(), {
      actorUserId: req.user!.id, actorUsername: req.user!.username, ipAddress: req.socket.remoteAddress,
      action: 'backup.downloaded', targetType: 'backup', targetId: id,
    });
    res.download(file, row.filename);
  });

  return router;
}
