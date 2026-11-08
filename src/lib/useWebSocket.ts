import { useEffect, useRef, useState, useCallback } from 'react';

type WsMessage = { type: string; payload: unknown };
export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let wsRef: WebSocket | null = null;
const listeners = new Set<(msg: WsMessage) => void>();
const connectionListeners = new Set<(status: WsConnectionStatus) => void>();
let connectionStatus: WsConnectionStatus = 'connecting';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function updateConnectionStatus(status: WsConnectionStatus) {
  if (connectionStatus === status) return;
  connectionStatus = status;
  connectionListeners.forEach((listener) => listener(status));
}

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
  if (wsRef?.readyState === WebSocket.OPEN) {
    updateConnectionStatus('connected');
    return;
  }
  if (wsRef?.readyState === WebSocket.CONNECTING) {
    updateConnectionStatus('connecting');
    return;
  }

  updateConnectionStatus('connecting');
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws`;

  try {
    const socket = new WebSocket(url);
    wsRef = socket;

    socket.onopen = () => {
      if (wsRef !== socket) return;
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      updateConnectionStatus('connected');
    };

    socket.onmessage = (e) => {
      if (wsRef !== socket) return;
      try {
        const msg = JSON.parse(e.data) as WsMessage;
        listeners.forEach((fn) => fn(msg));
      } catch { /* ignore malformed messages */ }
    };

    socket.onclose = () => {
      if (wsRef !== socket) return;
      wsRef = null;
      updateConnectionStatus('disconnected');
      scheduleReconnect();
    };

    socket.onerror = () => {
      if (wsRef !== socket) return;
      // Closing this specific socket lets onclose schedule the next attempt.
      socket.close();
    };
  } catch {
    wsRef = null;
    updateConnectionStatus('disconnected');
    scheduleReconnect();
  }
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
  const [status, setStatus] = useState<WsConnectionStatus>(connectionStatus);
  const cbRef = useRef<(msg: WsMessage) => void>(() => {});

  cbRef.current = setLastMessage;

  useEffect(() => {
    const listener = (msg: WsMessage) => cbRef.current(msg);
    const statusListener = (nextStatus: WsConnectionStatus) => setStatus(nextStatus);
    listeners.add(listener);
    connectionListeners.add(statusListener);
    setStatus(connectionStatus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    connect();

    return () => {
      listeners.delete(listener);
      connectionListeners.delete(statusListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (listeners.size === 0) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        reconnectAttempts = 0;
        wsRef?.close();
        wsRef = null;
        updateConnectionStatus('disconnected');
      }
    };
  }, []);

  const onMessage = useCallback((type: string, handler: (payload: unknown) => void) => {
    if (lastMessage?.type === type) handler(lastMessage.payload);
  }, [lastMessage]);

  return { lastMessage, onMessage, connectionStatus: status };
}
