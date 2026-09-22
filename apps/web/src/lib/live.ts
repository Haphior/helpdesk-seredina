import { useEffect, useRef, useSyncExternalStore } from 'react';
import { API_URL, endSession, getToken } from './api';

// Live console updates (docs/adr/0053-live-updates.md). Mirrors
// packages/shared/src/liveEvents.ts -- the web app doesn't depend on
// @seredina/shared, so the shape is kept in sync by hand. Events carry ids
// only: a view that cares refetches through the normal API.
export type LiveEvent =
  | { type: 'ticket.created'; ticketId: string }
  | { type: 'ticket.updated'; ticketId: string }
  | { type: 'message.created'; ticketId: string }
  | { type: 'sla.breached'; ticketId: string }
  | { type: 'notification.created'; userId: string }
  // Sent locally after a reconnect: events may have been missed while offline,
  // so every view should refetch what it shows.
  | { type: 'resync' };

export type LiveStatus = 'connecting' | 'live' | 'offline';

type Listener = (event: LiveEvent) => void;

const MAX_BACKOFF_MS = 30_000;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let status: LiveStatus = 'offline';
let controller: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let everConnected = false;

function setStatus(next: LiveStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function emit(event: LiveEvent) {
  listeners.forEach((l) => l(event));
}

function scheduleReconnect() {
  if (listeners.size === 0 || reconnectTimer) return;
  // Exponential backoff with jitter, so a restarted API isn't hit by every
  // open console in the same instant.
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures) * (0.75 + Math.random() * 0.5);
  failures++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

// fetch() instead of EventSource: EventSource can't send an Authorization
// header, and a token in the URL would end up in proxy and access logs.
async function connect() {
  const token = getToken();
  if (!token || controller) return;
  const current = new AbortController();
  controller = current;
  setStatus('connecting');

  try {
    const res = await fetch(`${API_URL}/events`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: current.signal,
    });
    if (res.status === 401) {
      endSession();
      return;
    }
    if (!res.ok || !res.body) throw new Error(`live stream answered ${res.status}`);

    failures = 0;
    setStatus('live');
    if (everConnected) emit({ type: 'resync' });
    everConnected = true;

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.split('\n').find((line) => line.startsWith('data: '));
        if (!data || block.startsWith('event: ready')) continue;
        try {
          emit(JSON.parse(data.slice('data: '.length)) as LiveEvent);
        } catch {
          // A malformed frame is skipped, never fatal to the stream.
        }
      }
    }
    throw new Error('live stream closed');
  } catch {
    if (current.signal.aborted) return;
    setStatus('offline');
    scheduleReconnect();
  } finally {
    if (controller === current) controller = null;
  }
}

function stop() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  controller?.abort();
  controller = null;
  setStatus('offline');
}

/** One shared connection per tab: opened by the first subscriber, closed with the last. */
export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    failures = 0;
    void connect();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Calls `handler` for every live event while the component is mounted. */
export function useLiveEvents(handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeLive((event) => ref.current(event)), []);
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (onChange) => {
      statusListeners.add(onChange);
      return () => statusListeners.delete(onChange);
    },
    () => status,
  );
}
