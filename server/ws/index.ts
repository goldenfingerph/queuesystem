import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const clients = new Set<WebSocket>();
const aliveClients = new Set<WebSocket>();
const MAX_WS_CLIENTS = 100;

export function initWs(server: import('node:http').Server): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({
    server,
    path: '/ws',
    // Queue updates are server-to-client only. Keep inbound frames tiny and
    // disable compression to reduce resource-exhaustion opportunities.
    maxPayload: 1024,
    perMessageDeflate: false,
    verifyClient: (info, done) => {
      const origin = info.origin;
      const requestHost = info.req.headers.host;
      if (!origin || !requestHost) {
        done(false, 403, 'A same-origin browser connection is required');
        return;
      }

      try {
        const originUrl = new URL(origin);
        const sameHost = originUrl.host.toLowerCase() === requestHost.toLowerCase();
        const supportedProtocol = originUrl.protocol === 'http:' || originUrl.protocol === 'https:';
        if (!sameHost || !supportedProtocol) {
          done(false, 403, 'WebSocket origin is not allowed');
          return;
        }
      } catch {
        done(false, 403, 'Invalid WebSocket origin');
        return;
      }

      if (clients.size >= MAX_WS_CLIENTS) {
        done(false, 503, 'WebSocket connection limit reached');
        return;
      }
      done(true);
    },
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    aliveClients.add(ws);
    ws.on('pong', () => aliveClients.add(ws));
    // This endpoint only broadcasts queue events; clients must not send data.
    ws.on('message', () => ws.close(1008, 'Server is broadcast-only'));
    ws.on('close', () => {
      clients.delete(ws);
      aliveClients.delete(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
      aliveClients.delete(ws);
    });
    ws.send(JSON.stringify({ type: 'connected', payload: { serverTime: new Date().toISOString() } }));
  });

  // Detect dead LAN/Wi-Fi connections so stale sockets do not accumulate.
  heartbeatTimer = setInterval(() => {
    for (const ws of clients) {
      if (!aliveClients.has(ws)) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      aliveClients.delete(ws);
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          clients.delete(ws);
          aliveClients.delete(ws);
          ws.terminate();
        }
      } else if (ws.readyState !== WebSocket.CONNECTING) {
        clients.delete(ws);
        aliveClients.delete(ws);
      }
    }
  }, 30_000);
  heartbeatTimer.unref();

  return wss;
}

export function broadcast(type: string, payload: unknown): void {
  const msg = JSON.stringify({ type, payload });
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(msg, (error) => {
        if (error) {
          clients.delete(ws);
          aliveClients.delete(ws);
          ws.terminate();
        }
      });
    } catch {
      clients.delete(ws);
      aliveClients.delete(ws);
      ws.terminate();
    }
  }
}

export function closeWs(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (wss) {
    for (const ws of clients) ws.close();
    clients.clear();
    aliveClients.clear();
    wss.close();
    wss = null;
  }
}
