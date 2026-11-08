import http from 'node:http';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { initWs, closeWs } from './ws/index.js';

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
  getDb(); // Run migrations and initialize the first administrator before accepting LAN traffic.
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
