import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware, requireRole } from './lib/middleware.js';
import { getDb } from './db/index.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { servicesRouter } from './routes/services.js';
import { countersRouter } from './routes/counters.js';
import { staffRouter } from './routes/staff.js';
import { ticketsRouter } from './routes/tickets.js';
import { settingsRouter } from './routes/settings.js';
import { reportsRouter } from './routes/reports.js';
import { adsRouter } from './routes/ads.js';
import { adsManageRouter } from './routes/ads-manage.js';
import { logoManageRouter } from './routes/logo-manage.js';
import { backupRouter } from './routes/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const protectUnlessGet = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') return next();
  return authMiddleware(req, res, (authError?: unknown) => {
    if (authError) return next(authError);
    return requireRole('admin')(req, res, next);
  });
};

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // Baseline security headers without a restrictive CSP: the LAN UI uses
  // runtime-generated styles and same-origin media. Add HSTS at the TLS
  // termination layer once HTTPS is enabled for the deployment.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use(healthRouter());
  app.use('/api/auth', authRouter());

  // Public read-only data needed by the welcome/reception screens and TV.
  // Every mutation remains protected by a valid staff session.
  app.use('/api/services', protectUnlessGet, servicesRouter());
  app.use('/api/settings', protectUnlessGet, settingsRouter());
  app.use('/api/logo', protectUnlessGet, logoManageRouter());
  app.use('/api/ads', protectUnlessGet, adsManageRouter());

  // Public TV projection deliberately excludes visitor names/contact details.
  app.get('/api/tv/queue', (_req, res) => {
    const db = getDb();
    const projection = `SELECT t.id, t.number, t.status, t.counter_id, t.created_at,
              s.name AS service_name, s.name_ar AS service_name_ar, c.number AS counter_number,
              vc.label_en AS category_label
       FROM tickets t
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN counters c ON c.id = t.counter_id
       LEFT JOIN visitor_categories vc ON vc.id = t.visitor_category_id`;
    // Globally order active tickets by the latest call. The newest active
    // ticket is shown in the large Now Serving area; the next four remain
    // visible in the Currently Serving strip until they are completed.
    const currentTickets = db.prepare(
      `${projection} WHERE t.status IN ('called','serving')
       ORDER BY
         (SELECT MAX(qe.id) FROM queue_events qe
          WHERE qe.ticket_id = t.id AND qe.event_type IN ('called','recalled')) DESC,
         t.called_at DESC, t.id DESC`,
    ).all();
    const latestTicket = currentTickets[0] ?? null;
    const currentlyServing = currentTickets.slice(1, 5);
    // Match the same priority/FIFO ordering used by Call Next.
    // The TV shows the next 12 positions while retaining the total waiting count.
    const waitingTickets = db.prepare(
      `${projection} WHERE t.status = 'waiting'
       ORDER BY
         CASE WHEN COALESCE(vc.priority_rank, t.priority_rank, 99) <= 3 THEN 0 ELSE 1 END ASC,
         CASE WHEN COALESCE(vc.priority_rank, t.priority_rank, 99) <= 3
           THEN COALESCE(vc.priority_rank, t.priority_rank, 99) ELSE 0 END ASC,
         t.transfer_priority DESC,
         CASE WHEN COALESCE((SELECT value FROM system_settings WHERE key = 'queue_mode'), 'priority') = 'fifo'
           THEN 0 ELSE COALESCE(vc.priority_rank, t.priority_rank, 99) END ASC,
         t.created_at ASC, t.id ASC`,
    ).all() as Array<Record<string, unknown>>;
    const rankedWaitingTickets = waitingTickets.map((ticket, index) => ({ ...ticket, queue_position: index + 1 }));
    const recentCallLimit = 3;
    const recentCalls = db.prepare(
      `${projection} WHERE t.called_at IS NOT NULL AND t.counter_id IS NOT NULL AND t.status IN ('called','serving','completed')
       ORDER BY t.called_at DESC, t.id DESC LIMIT ?`,
    ).all(recentCallLimit);
    res.json({ currentTickets, latestTicket, currentlyServing, waitingTickets: rankedWaitingTickets, recentCalls });
  });

  // Local advertisement files are public read-only media for the TV display.
  // Mount this BEFORE the general /api authentication middleware below.
  app.use('/api/media', adsRouter());

  // Full ticket records and all ticket-changing operations require staff login.
  app.use('/api/tickets', authMiddleware, ticketsRouter());
  app.use('/api/counters', authMiddleware, countersRouter());
  app.use('/api/staff', authMiddleware, requireRole('admin'), staffRouter());
  app.use('/api/reports', authMiddleware, reportsRouter());

  // Keep the catch-all admin API protection after the explicitly public routes.
  app.use('/api', authMiddleware, requireRole('admin'), backupRouter());

  const webRoot = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(webRoot, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/health' || req.path === '/ws') return next();
    res.sendFile(path.join(webRoot, 'index.html'), (err) => { if (err) next(err); });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http] request failed:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'An unexpected server error occurred. Check the server console for details.' });
  });
  return app;
}
