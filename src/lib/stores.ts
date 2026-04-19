export type Unsubscriber = () => void;
export type Subscriber<T> = (value: T) => void;

export interface Readable<T> {
  subscribe(run: Subscriber<T>): Unsubscriber;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(fn: (value: T) => T): void;
  get(): T;
}

export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const subs = new Set<Subscriber<T>>();
  return {
    subscribe(run) {
      subs.add(run);
      run(value);
      return () => subs.delete(run);
    },
    set(v) {
      if (Object.is(v, value)) return;
      value = v;
      for (const s of subs) s(value);
    },
    update(fn) {
      this.set(fn(value));
    },
    get() {
      return value;
    },
  };
}

export type AccountStatus =
  | 'ready'
  | 'active'
  | 'warming'
  | 'paused'
  | 'suspended'
  | 'banned'
  | 'error'
  | 'deleted';

export interface AccountRecord {
  id: string;
  username?: string;
  status: AccountStatus;
  last_action_at?: string | null;
}

export interface PlanSummary {
  id: string;
  name: string;
  max_accounts: number;
  price_cents: number;
}

export interface BatchProgress {
  batch_id: string;
  success_count?: number;
  fail_count?: number;
  total?: number;
  status?: string;
  [key: string]: unknown;
}

export type AccountsState = Record<string, AccountRecord>;
export type BatchState = Record<string, BatchProgress>;

export const accountsStore = writable<AccountsState>({});
export const balanceStore = writable<number | null>(null);
export const batchStore = writable<BatchState>({});
export const planStore = writable<PlanSummary | null>(null);

export function resetStoresForTest(): void {
  accountsStore.set({});
  balanceStore.set(null);
  batchStore.set({});
  planStore.set(null);
}

export interface AccountStateChanged {
  customer_id: string;
  account_id: string;
  status: AccountStatus;
  username?: string;
  last_action_at?: string | null;
}

export interface BalanceChanged {
  customer_id: string;
  balance_cents: number;
}

export interface BatchProgressEvent extends BatchProgress {
  customer_id: string;
}

export function applyRealtimeEvent(event: string, raw: string): void {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (!data || typeof data !== 'object') return;

  switch (event) {
    case 'account_state_changed': {
      const d = data as Partial<AccountStateChanged>;
      if (!d.account_id || !d.status) return;
      accountsStore.update((s) => {
        const prev = s[d.account_id as string];
        return {
          ...s,
          [d.account_id as string]: {
            ...(prev ?? { id: d.account_id as string }),
            id: d.account_id as string,
            status: d.status as AccountStatus,
            ...(d.username !== undefined ? { username: d.username } : {}),
            ...(d.last_action_at !== undefined ? { last_action_at: d.last_action_at } : {}),
          },
        };
      });
      return;
    }
    case 'balance_changed': {
      const d = data as Partial<BalanceChanged>;
      if (typeof d.balance_cents !== 'number') return;
      balanceStore.set(d.balance_cents);
      return;
    }
    case 'batch_progress': {
      const d = data as Partial<BatchProgressEvent>;
      if (!d.batch_id) return;
      const entry: BatchProgress = { ...(d as BatchProgress) };
      batchStore.update((s) => ({ ...s, [d.batch_id as string]: entry }));
      return;
    }
  }
}
