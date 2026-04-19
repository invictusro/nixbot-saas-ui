import { describe, it, expect, beforeEach } from 'vitest';
import { connectRealtime } from './sse';
import {
  accountsStore,
  balanceStore,
  batchStore,
  resetStoresForTest,
} from './stores';

type Listener = (ev: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(public url: string, public init?: { withCredentials?: boolean }) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const cur = this.listeners.get(type) ?? [];
    cur.push(listener);
    this.listeners.set(type, cur);
  }

  emit(type: string, data: string): void {
    const ls = this.listeners.get(type) ?? [];
    for (const l of ls) l({ data });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  error(): void {
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}

function withFakeTimers() {
  type Task = { id: number; fn: () => void; at: number };
  let now = 0;
  let next = 1;
  const tasks: Task[] = [];
  const setTimeoutFn = (fn: () => void, ms: number) => {
    const t = { id: next++, fn, at: now + ms } as Task;
    tasks.push(t);
    return t as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimeoutFn = (id: ReturnType<typeof setTimeout>) => {
    const t = id as unknown as Task;
    const idx = tasks.findIndex((x) => x.id === t.id);
    if (idx >= 0) tasks.splice(idx, 1);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    tasks.sort((a, b) => a.at - b.at);
    while (tasks.length > 0 && tasks[0].at <= target) {
      const t = tasks.shift()!;
      now = t.at;
      t.fn();
      tasks.sort((a, b) => a.at - b.at);
    }
    now = target;
  };
  return { setTimeoutFn, clearTimeoutFn, advance, now: () => now, pending: () => tasks.length };
}

describe('connectRealtime', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    resetStoresForTest();
  });

  it('updates accountsStore within 100ms of server publish', async () => {
    const start = Date.now();
    const h = connectRealtime({
      eventSourceCtor: FakeEventSource as unknown as typeof FakeEventSource,
    });
    expect(h.transport()).toBe('sse');
    const es = FakeEventSource.instances[0];
    es.open();
    es.emit(
      'account_state_changed',
      JSON.stringify({ customer_id: 'c1', account_id: 'a1', status: 'active' }),
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(accountsStore.get()).toEqual({ a1: { id: 'a1', status: 'active' } });
    h.close();
  });

  it('updates balance and batch stores on corresponding events', () => {
    const h = connectRealtime({
      eventSourceCtor: FakeEventSource as unknown as typeof FakeEventSource,
    });
    const es = FakeEventSource.instances[0];
    es.emit('balance_changed', JSON.stringify({ customer_id: 'c1', balance_cents: 4200 }));
    es.emit(
      'batch_progress',
      JSON.stringify({
        customer_id: 'c1',
        batch_id: 'b1',
        success_count: 3,
        fail_count: 1,
        total: 10,
      }),
    );
    expect(balanceStore.get()).toBe(4200);
    expect(batchStore.get()).toEqual({
      b1: {
        customer_id: 'c1',
        batch_id: 'b1',
        success_count: 3,
        fail_count: 1,
        total: 10,
      },
    });
    h.close();
  });

  it('disconnect triggers reconnect with exponential backoff', () => {
    const clk = withFakeTimers();
    const h = connectRealtime({
      eventSourceCtor: FakeEventSource as unknown as typeof FakeEventSource,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2 },
      setTimeoutFn: clk.setTimeoutFn,
      clearTimeoutFn: clk.clearTimeoutFn,
    });
    const es1 = FakeEventSource.instances[0];
    es1.error();
    expect(es1.closed).toBe(true);
    expect(FakeEventSource.instances.length).toBe(1);
    clk.advance(99);
    expect(FakeEventSource.instances.length).toBe(1);
    clk.advance(1);
    expect(FakeEventSource.instances.length).toBe(2);
    const es2 = FakeEventSource.instances[1];
    es2.error();
    clk.advance(200);
    expect(FakeEventSource.instances.length).toBe(3);
    const es3 = FakeEventSource.instances[2];
    es3.open();
    es3.emit(
      'account_state_changed',
      JSON.stringify({ customer_id: 'c1', account_id: 'z', status: 'ready' }),
    );
    expect(accountsStore.get()).toEqual({ z: { id: 'z', status: 'ready' } });
    h.close();
  });

  it('close() stops emitting store updates (no memory leak on route change)', () => {
    const h = connectRealtime({
      eventSourceCtor: FakeEventSource as unknown as typeof FakeEventSource,
    });
    const es = FakeEventSource.instances[0];
    h.close();
    expect(es.closed).toBe(true);
    expect(h.transport()).toBe('closed');
    es.emit(
      'account_state_changed',
      JSON.stringify({ customer_id: 'c1', account_id: 'x', status: 'active' }),
    );
    expect(accountsStore.get()).toEqual({ x: { id: 'x', status: 'active' } });
    es.error();
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it('close() cancels pending reconnect (no spurious EventSource after close)', () => {
    const clk = withFakeTimers();
    const h = connectRealtime({
      eventSourceCtor: FakeEventSource as unknown as typeof FakeEventSource,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2 },
      setTimeoutFn: clk.setTimeoutFn,
      clearTimeoutFn: clk.clearTimeoutFn,
    });
    FakeEventSource.instances[0].error();
    h.close();
    clk.advance(10_000);
    expect(FakeEventSource.instances.length).toBe(1);
    expect(clk.pending()).toBe(0);
  });

  it('falls back to 5s polling when EventSource unavailable (feature detect)', async () => {
    const clk = withFakeTimers();
    let polls = 0;
    const h = connectRealtime({
      eventSourceCtor: null,
      pollIntervalMs: 5000,
      setTimeoutFn: clk.setTimeoutFn,
      clearTimeoutFn: clk.clearTimeoutFn,
      async fetchSnapshot() {
        polls++;
        return {
          accounts: { a1: { id: 'a1', status: 'active' } },
          balance_cents: 1000 + polls,
        };
      },
    });
    expect(h.transport()).toBe('polling');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(polls).toBe(1);
    expect(accountsStore.get()).toEqual({ a1: { id: 'a1', status: 'active' } });
    expect(balanceStore.get()).toBe(1001);
    clk.advance(5000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(polls).toBe(2);
    h.close();
    const before = polls;
    clk.advance(20_000);
    await Promise.resolve();
    expect(polls).toBe(before);
  });

  it('ignores malformed payloads silently', () => {
    const h = connectRealtime({
      eventSourceCtor: FakeEventSource as unknown as typeof FakeEventSource,
    });
    const es = FakeEventSource.instances[0];
    es.emit('account_state_changed', '{not json');
    es.emit('account_state_changed', JSON.stringify({ customer_id: 'c1' }));
    es.emit('balance_changed', JSON.stringify({ customer_id: 'c1' }));
    expect(accountsStore.get()).toEqual({});
    expect(balanceStore.get()).toBeNull();
    h.close();
  });
});
