import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const clients = new Set<WebSocket>();
const aliveClients = new Set<WebSocket>();

export function initWs(server: import('node:http').Server): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ server, path: '/ws' });
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
