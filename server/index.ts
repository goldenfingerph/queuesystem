import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { config, validateServerEnvironment } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { initWs, closeWs } from './ws/index.js';
import { pruneQueueEvents } from './lib/queue-event-retention.js';

type QueueServer = http.Server | https.Server;

function createQueueServer(app: import('express').Express): QueueServer {
  const hasCertificate = Boolean(config.tlsCertFile);
  const hasPrivateKey = Boolean(config.tlsKeyFile);
  if (hasCertificate !== hasPrivateKey) {
    throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together. Set both to enable HTTPS/WSS.');
  }

  if (hasCertificate && hasPrivateKey) {
    const cert = fs.readFileSync(config.tlsCertFile!);
    const key = fs.readFileSync(config.tlsKeyFile!);
    return https.createServer({ cert, key, minVersion: 'TLSv1.2' }, app);
  }

  console.warn('[security] TLS is not configured. LAN traffic is using HTTP/WS; credentials and session tokens are not encrypted in transit.');
  return http.createServer(app);
}

function gracefulShutdown(server: QueueServer, signal: string): void {
  console.log(`\n[server] received ${signal}, shutting down...`);
  closeWs();
  server.close((error) => {
    if (error) {
      console.error('[server] error while closing HTTP(S) server:', error);
      process.exitCode = 1;
    }
    closeDb();
    process.exit();
  });
}

async function start(): Promise<void> {
  // Fail before opening SQLite or running migrations if the operator's
  // environment, certificate pair, or configured paths are invalid.
  validateServerEnvironment();
  const { createApp } = await import('./app.js');
  const app = createApp();
  const server = createQueueServer(app);
  const db = getDb(); // Run migrations and initialize the first administrator before accepting LAN traffic.
  console.log('[server] database ready at', config.dbPath);

  const runQueueEventRetention = (): void => {
    try {
      const removed = pruneQueueEvents(db, config.queueEventRetentionDays);
      if (removed > 0) console.log(`[maintenance] pruned ${removed} old queue events (retention: ${config.queueEventRetentionDays} days)`);
    } catch (error) {
      // Maintenance must never prevent the queue server from continuing to run.
      console.error('[maintenance] queue event retention failed:', error);
    }
  };
  runQueueEventRetention();
  const retentionTimer = setInterval(runQueueEventRetention, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
  initWs(server);
  const protocol = server instanceof https.Server ? 'https' : 'http';
  const wsProtocol = protocol === 'https' ? 'wss' : 'ws';

  server.listen(config.port, config.host, () => {
    console.log('=================================================');
    console.log('  INFINITY SERVICES — Queue Management System');
    console.log('=================================================');
    console.log(`  Local:  ${protocol}://localhost:${config.port}`);
    console.log(`  LAN:    ${protocol}://<server-ip>:${config.port}`);
    console.log(`  WS:     ${wsProtocol}://<server-ip>:${config.port}/ws`);
    console.log('  Health: GET /health');
    console.log('-------------------------------------------------');
    console.log(`  Bound to ${config.host}:${config.port} (LAN clients can connect)`);
    if (protocol === 'https') console.log('  TLS:    enabled (TLS 1.2 minimum)');
    console.log('=================================================');
  });

  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
