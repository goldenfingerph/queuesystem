import http from 'node:http';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { initWs, closeWs } from './ws/index.js';
import { healthRouter } from './routes/health.js';
import { backupRouter } from './routes/backup.js';
import { adsRouter } from './routes/ads.js';
import { authRouter } from './routes/auth.js';
import { servicesRouter } from './routes/services.js';
import { countersRouter } from './routes/counters.js';
import { staffRouter } from './routes/staff.js';
import { ticketsRouter } from './routes/tickets.js';
import { settingsRouter } from './routes/settings.js';
import { reportsRouter } from './routes/reports.js';
import { adsManageRouter } from './routes/ads-manage.js';
import { authMiddleware } from './lib/middleware.js';
import { pruneQueueEvents, QUEUE_EVENT_RETENTION_INTERVAL_MS } from './lib/queue-event-retention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function gracefulShutdown(server: http.Server, signal: string): void {
  console.log(`\n[server] received ${signal}, shutting down...`);
  // Stop WebSocket clients and stop accepting new HTTP connections first.
  closeWs();
  server.close((error) => {
    if (error) {
      console.error('[server] error while closing HTTP server:', error);
      process.exitCode = 1;
    }
    // Close SQLite only after active HTTP requests have finished.
    closeDb();
    process.exit();
  });
}

async function start(): Promise<void> {
  const { createApp } = await import('./app.js');
  const app = createApp();
  const db = getDb(); // Run migrations and initialize the first administrator before accepting LAN traffic.

  const runQueueEventRetention = () => {
    try {
      const result = pruneQueueEvents(db);
      if (result.deleted > 0) {
        console.log(`[maintenance] pruned ${result.deleted} queue events older than ${result.retentionDays} days`);
      }
    } catch (error) {
      // Maintenance failure must not prevent the queue server from starting or serving traffic.
      console.warn('[maintenance] queue event retention failed:', error);
    }
  };
  runQueueEventRetention();
  const retentionTimer = setInterval(runQueueEventRetention, QUEUE_EVENT_RETENTION_INTERVAL_MS);
  retentionTimer.unref();

  console.log('[server] database ready at', config.dbPath);

  const server = http.createServer(app);
  initWs(server);

  server.listen(config.port, config.host, () => {
    console.log('=================================================');
    console.log('  INFINITY SERVICES — Queue Management System');
    console.log('=================================================');
    console.log(`  HTTP:   http://localhost:${config.port}`);
    console.log(`  LAN:    http://<server-ip>:${config.port}`);
    console.log(`  WS:     ws://<server-ip>:${config.port}/ws`);
    console.log(`  Health: GET /health`);
    console.log('-------------------------------------------------');
    console.log(`  Bound to ${config.host}:${config.port} (LAN clients can connect)`);
    console.log('=================================================');
  });

  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
