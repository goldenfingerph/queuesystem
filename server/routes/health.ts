import { Router } from 'express';
import { getDb } from '../db/index.js';

export function healthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    try {
      const db = getDb();
      // Lightweight probe — confirms the DB file is open and readable.
      const row = db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get() as { n: number };
      res.json({
        status: 'ok',
        service: 'INFINITY SERVICES — Queue Management System',
        database: 'connected',
        tables: row.n,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[health] database probe failed:', err);
      res.status(503).json({
        status: 'error',
        database: 'unavailable',
        message: 'Database unavailable. Check the server console for details.',
      });
    }
  });

  return router;
}
