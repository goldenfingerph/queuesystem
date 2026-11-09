import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

let wss: WebSocketServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const clients = new Set<WebSocket>();
const aliveClients = new Set<WebSocket>();

export function isAllowedWebSocketOrigin(origin: string | undefined, host: string | undefined, secure: boolean): boolean {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const expectedProtocol = secure ? 'https:' : 'http:';
    return parsed.protocol === expectedProtocol && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function initWs(server: HttpServer | HttpsServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    verifyClient: (info, done) => {
      const secure = Boolean((info.req.socket as typeof info.req.socket & { encrypted?: boolean }).encrypted);
      const allowed = isAllowedWebSocketOrigin(info.origin, info.req.headers.host, secure);
      done(allowed, allowed ? undefined : 403, 'WebSocket origin is not allowed');
    },
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    aliveClients.add(ws);
    ws.on('pong', () => aliveClients.add(ws));
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
