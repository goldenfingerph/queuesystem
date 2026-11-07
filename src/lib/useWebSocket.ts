import { useEffect, useRef, useState, useCallback } from 'react';

type WsMessage = { type: string; payload: unknown };

let wsRef: WebSocket | null = null;
const listeners = new Set<(msg: WsMessage) => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function scheduleReconnect() {
  if (reconnectTimer || listeners.size === 0) return;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempts, 5));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (listeners.size === 0) return;
  if (wsRef?.readyState === WebSocket.OPEN || wsRef?.readyState === WebSocket.CONNECTING) return;

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws`;
  const socket = new WebSocket(url);
  wsRef = socket;

  socket.onopen = () => {
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as WsMessage;
      listeners.forEach((fn) => fn(msg));
    } catch { /* ignore malformed messages */ }
  };

  socket.onclose = () => {
    if (wsRef === socket) wsRef = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    // Closing this specific socket lets onclose schedule the next attempt.
    socket.close();
  };
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' &&
      (!wsRef || wsRef.readyState === WebSocket.CLOSED)) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connect();
  }
}

export function useWebSocket() {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const cbRef = useRef<(msg: WsMessage) => void>(() => {});

  cbRef.current = setLastMessage;

  useEffect(() => {
    const listener = (msg: WsMessage) => cbRef.current(msg);
    listeners.add(listener);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    connect();

    return () => {
      listeners.delete(listener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (listeners.size === 0) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        reconnectAttempts = 0;
        wsRef?.close();
        wsRef = null;
      }
    };
  }, []);

  const onMessage = useCallback((type: string, handler: (payload: unknown) => void) => {
    if (lastMessage?.type === type) handler(lastMessage.payload);
  }, [lastMessage]);

  return { lastMessage, onMessage };
}
