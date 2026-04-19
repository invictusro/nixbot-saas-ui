import { applyRealtimeEvent, accountsStore, balanceStore, batchStore } from './stores';

type MessageEventLike = { data: unknown };

type EventSourceLike = {
  readonly readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(
    type: string,
    listener: (ev: MessageEventLike) => void,
  ): void;
  close(): void;
};

type EventSourceCtor = new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike;

type Snapshot = {
  accounts?: Record<string, { id: string; status: string }>;
  balance_cents?: number;
  batches?: Record<string, Record<string, unknown>>;
};

export type TransportKind = 'sse' | 'polling' | 'closed';

export interface ConnectOptions {
  endpoint?: string;
  eventSourceCtor?: EventSourceCtor | null;
  fetchSnapshot?: () => Promise<Snapshot>;
  pollIntervalMs?: number;
  backoff?: { initialMs: number; maxMs: number; factor: number };
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  onTransport?: (kind: TransportKind) => void;
  channels?: string[];
}

export interface RealtimeHandle {
  close(): void;
  transport(): TransportKind;
}

const DEFAULT_CHANNELS = ['account_state_changed', 'balance_changed', 'batch_progress'];

function resolveEventSourceCtor(opts: ConnectOptions): EventSourceCtor | null {
  if (opts.eventSourceCtor !== undefined) return opts.eventSourceCtor;
  const es = (globalThis as { EventSource?: EventSourceCtor }).EventSource;
  return es ?? null;
}

export function connectRealtime(opts: ConnectOptions = {}): RealtimeHandle {
  const endpoint = opts.endpoint ?? '/customer/events';
  const channels = opts.channels ?? DEFAULT_CHANNELS;
  const backoff = opts.backoff ?? { initialMs: 500, maxMs: 30_000, factor: 2 };
  const pollInterval = opts.pollIntervalMs ?? 5_000;
  const setTimeoutFn = opts.setTimeoutFn ?? ((f, ms) => setTimeout(f, ms));
  const clearTimeoutFn = opts.clearTimeoutFn ?? ((id) => clearTimeout(id));
  const emit = (k: TransportKind) => opts.onTransport?.(k);

  let closed = false;
  let transport: TransportKind = 'closed';
  let currentSource: EventSourceLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const ctor = resolveEventSourceCtor(opts);

  function clearTimers() {
    if (reconnectTimer !== null) {
      clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }
    if (pollTimer !== null) {
      clearTimeoutFn(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = Math.min(backoff.maxMs, backoff.initialMs * Math.pow(backoff.factor, attempt));
    attempt++;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      openSSE();
    }, delay);
  }

  function openSSE() {
    if (closed || !ctor) return;
    let es: EventSourceLike;
    try {
      es = new ctor(endpoint, { withCredentials: true });
    } catch {
      scheduleReconnect();
      return;
    }
    currentSource = es;
    transport = 'sse';
    emit('sse');

    es.onopen = () => {
      attempt = 0;
    };
    es.onerror = () => {
      if (closed) return;
      es.close();
      if (currentSource === es) currentSource = null;
      scheduleReconnect();
    };
    for (const ch of channels) {
      es.addEventListener(ch, (ev: MessageEventLike) => {
        applyRealtimeEvent(ch, typeof ev.data === 'string' ? ev.data : String(ev.data));
      });
    }
  }

  async function pollOnce() {
    if (closed || !opts.fetchSnapshot) return;
    try {
      const snap = await opts.fetchSnapshot();
      if (closed) return;
      if (snap.accounts) {
        const next: Record<string, { id: string; status: string }> = {};
        for (const [id, rec] of Object.entries(snap.accounts)) next[id] = rec;
        accountsStore.set(next as never);
      }
      if (typeof snap.balance_cents === 'number') balanceStore.set(snap.balance_cents);
      if (snap.batches) batchStore.set(snap.batches as never);
    } catch {
      // swallow — next poll will retry
    }
  }

  function startPolling() {
    transport = 'polling';
    emit('polling');
    const tick = () => {
      if (closed) return;
      pollOnce().finally(() => {
        if (closed) return;
        pollTimer = setTimeoutFn(tick, pollInterval);
      });
    };
    tick();
  }

  if (ctor) {
    openSSE();
  } else {
    startPolling();
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      transport = 'closed';
      clearTimers();
      if (currentSource) {
        currentSource.close();
        currentSource = null;
      }
      emit('closed');
    },
    transport() {
      return transport;
    },
  };
}
