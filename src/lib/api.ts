import type { AccountRecord, PlanSummary } from './stores';

export interface CustomerSummary {
  balance_cents: number;
  plan: PlanSummary;
  account_count: number;
}

export type WarmupPreset = 'conservative' | 'normal' | 'aggressive';

export interface WarmupSettings {
  preset?: WarmupPreset;
  daily_follows?: number;
  daily_unfollows?: number;
  daily_likes?: number;
  daily_comments?: number;
  daily_story_views?: number;
  daily_dms?: number;
  session_min_minutes?: number;
  session_max_minutes?: number;
  sessions_per_day?: number;
  active_hours_start?: number;
  active_hours_end?: number;
  jitter_percent?: number;
  ramp_up_days?: number;
  [key: string]: unknown;
}

export interface PostingSettings {
  preset?: WarmupPreset;
  posts_per_day?: number;
  min_gap_minutes?: number;
  max_gap_minutes?: number;
  captions_spintax?: string;
  [key: string]: unknown;
}

export interface AccountSettings {
  warmup: WarmupSettings;
  posting?: PostingSettings;
}

export interface AccountDetail extends AccountRecord {
  created_at?: string | null;
  warmup_started_at?: string | null;
  phone_id?: string | null;
  error_message?: string | null;
  settings: AccountSettings;
}

export interface TaskHistoryEntry {
  id: string;
  kind: string;
  status: 'success' | 'failure' | 'skipped' | 'running';
  started_at: string;
  finished_at?: string | null;
  detail?: string | null;
}

export interface TaskHistoryPage {
  tasks: TaskHistoryEntry[];
  next_cursor?: string | null;
}

export interface AccountsClient {
  list(): Promise<AccountRecord[]>;
  pause(id: string): Promise<AccountRecord>;
  resume(id: string): Promise<AccountRecord>;
  summary(): Promise<CustomerSummary>;
  get(id: string): Promise<AccountDetail>;
  history(id: string, opts?: { limit?: number; cursor?: string | null }): Promise<TaskHistoryPage>;
  updateSettings(id: string, settings: AccountSettings): Promise<AccountDetail>;
  startWarmup(id: string): Promise<AccountRecord>;
  remove(id: string): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const JSON_HEADERS: HeadersInit = { 'content-type': 'application/json' };

export function createAccountsClient(opts: ApiClientOptions = {}): AccountsClient {
  const baseUrl = opts.baseUrl ?? '';
  const f = opts.fetch ?? fetch.bind(globalThis);

  async function call<T>(path: string, method: string, body?: unknown): Promise<T | null> {
    const res = await f(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.statusText;
      let code: string | undefined;
      try {
        const data = (await res.clone().json()) as { error?: string; code?: string };
        if (data.error) msg = data.error;
        if (data.code) code = data.code;
      } catch {
        // non-json error body
      }
      throw new ApiError(res.status, msg, code);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  }

  function encId(id: string): string {
    return encodeURIComponent(id);
  }

  return {
    async list() {
      const res = (await call<{ accounts: AccountRecord[] }>(
        '/api/customer/accounts',
        'GET',
      )) as { accounts: AccountRecord[] };
      return res.accounts;
    },
    async pause(id) {
      return (await call<AccountRecord>(
        `/api/customer/accounts/${encId(id)}/pause`,
        'POST',
      )) as AccountRecord;
    },
    async resume(id) {
      return (await call<AccountRecord>(
        `/api/customer/accounts/${encId(id)}/resume`,
        'POST',
      )) as AccountRecord;
    },
    async summary() {
      return (await call<CustomerSummary>('/api/customer/summary', 'GET')) as CustomerSummary;
    },
    async get(id) {
      return (await call<AccountDetail>(
        `/api/customer/accounts/${encId(id)}`,
        'GET',
      )) as AccountDetail;
    },
    async history(id, opts = {}) {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      const qs = params.toString();
      const path =
        `/api/customer/accounts/${encId(id)}/history` + (qs ? `?${qs}` : '');
      return (await call<TaskHistoryPage>(path, 'GET')) as TaskHistoryPage;
    },
    async updateSettings(id, settings) {
      return (await call<AccountDetail>(
        `/api/customer/accounts/${encId(id)}/settings`,
        'POST',
        settings,
      )) as AccountDetail;
    },
    async startWarmup(id) {
      return (await call<AccountRecord>(
        `/api/customer/accounts/${encId(id)}/start-warmup`,
        'POST',
      )) as AccountRecord;
    },
    async remove(id) {
      await call<void>(`/api/customer/accounts/${encId(id)}`, 'DELETE');
    },
  };
}

export const accountsClient = createAccountsClient();

export type BalanceTxnReason =
  | 'stripe_topup'
  | 'crypto_topup'
  | 'admin_credit'
  | 'admin_debit'
  | 'plan_fee'
  | 'account_creation'
  | 'refund';

export interface BalanceTransaction {
  id: string;
  type: 'credit' | 'debit';
  amount_cents: number;
  reason: BalanceTxnReason;
  description?: string | null;
  created_at: string;
}

export interface TransactionsPage {
  transactions: BalanceTransaction[];
  next_cursor?: string | null;
}

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

export interface CheckoutSession {
  url: string;
  session_id: string;
}

export interface BillingClient {
  createCheckoutSession(amountCents: number): Promise<CheckoutSession>;
  listTransactions(opts?: { limit?: number; cursor?: string | null }): Promise<TransactionsPage>;
  listPaymentMethods(): Promise<PaymentMethod[]>;
  deletePaymentMethod(id: string): Promise<void>;
  setDefaultPaymentMethod(id: string): Promise<PaymentMethod>;
}

export function createBillingClient(opts: ApiClientOptions = {}): BillingClient {
  const baseUrl = opts.baseUrl ?? '';
  const f = opts.fetch ?? fetch.bind(globalThis);

  async function call<T>(path: string, method: string, body?: unknown): Promise<T | null> {
    const res = await f(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.statusText;
      let code: string | undefined;
      try {
        const data = (await res.clone().json()) as { error?: string; code?: string };
        if (data.error) msg = data.error;
        if (data.code) code = data.code;
      } catch {
        // non-json error body
      }
      throw new ApiError(res.status, msg, code);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  }

  function encId(id: string): string {
    return encodeURIComponent(id);
  }

  return {
    async createCheckoutSession(amountCents) {
      return (await call<CheckoutSession>('/api/customer/billing/checkout', 'POST', {
        amount_cents: amountCents,
      })) as CheckoutSession;
    },
    async listTransactions(opts = {}) {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      const qs = params.toString();
      const path = '/api/customer/billing/transactions' + (qs ? `?${qs}` : '');
      return (await call<TransactionsPage>(path, 'GET')) as TransactionsPage;
    },
    async listPaymentMethods() {
      const res = (await call<{ payment_methods: PaymentMethod[] }>(
        '/api/customer/billing/payment-methods',
        'GET',
      )) as { payment_methods: PaymentMethod[] };
      return res.payment_methods;
    },
    async deletePaymentMethod(id) {
      await call<void>(`/api/customer/billing/payment-methods/${encId(id)}`, 'DELETE');
    },
    async setDefaultPaymentMethod(id) {
      return (await call<PaymentMethod>(
        `/api/customer/billing/payment-methods/${encId(id)}/default`,
        'POST',
      )) as PaymentMethod;
    },
  };
}

export const billingClient = createBillingClient();

export interface AdminCustomerRow {
  id: string;
  email: string;
  plan_id: string;
  plan_name?: string;
  balance_cents: number;
  account_count: number;
  is_admin?: boolean;
  suspended?: boolean;
  created_at?: string;
}

export interface AdminCustomersPage {
  customers: AdminCustomerRow[];
  next_cursor?: string | null;
}

export interface AdminCustomerDetail extends AdminCustomerRow {
  transactions?: BalanceTransaction[];
  accounts?: AccountRecord[];
  audit?: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  actor_id: string;
  impersonated_by?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  created_at: string;
}

export type AdminBalanceReason =
  | 'crypto_topup'
  | 'admin_credit'
  | 'admin_debit'
  | 'refund';

export interface AdminBalanceAdjustment {
  type: 'credit' | 'debit';
  amount_cents: number;
  reason: AdminBalanceReason;
  description?: string;
}

export interface ImpersonationResult {
  user: { id: string; email: string; impersonated_by?: string | null };
}

export interface AdminClient {
  listCustomers(opts?: {
    limit?: number;
    cursor?: string | null;
    query?: string;
  }): Promise<AdminCustomersPage>;
  getCustomer(id: string): Promise<AdminCustomerDetail>;
  adjustBalance(id: string, body: AdminBalanceAdjustment): Promise<BalanceTransaction>;
  impersonate(id: string): Promise<ImpersonationResult>;
}

export function createAdminClient(opts: ApiClientOptions = {}): AdminClient {
  const baseUrl = opts.baseUrl ?? '';
  const f = opts.fetch ?? fetch.bind(globalThis);

  async function call<T>(path: string, method: string, body?: unknown): Promise<T | null> {
    const res = await f(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.statusText;
      let code: string | undefined;
      try {
        const data = (await res.clone().json()) as { error?: string; code?: string };
        if (data.error) msg = data.error;
        if (data.code) code = data.code;
      } catch {
        // non-json error body
      }
      throw new ApiError(res.status, msg, code);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  }

  function encId(id: string): string {
    return encodeURIComponent(id);
  }

  return {
    async listCustomers(opts = {}) {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      if (opts.query) params.set('q', opts.query);
      const qs = params.toString();
      const path = '/api/admin/customers' + (qs ? `?${qs}` : '');
      return (await call<AdminCustomersPage>(path, 'GET')) as AdminCustomersPage;
    },
    async getCustomer(id) {
      return (await call<AdminCustomerDetail>(
        `/api/admin/customers/${encId(id)}`,
        'GET',
      )) as AdminCustomerDetail;
    },
    async adjustBalance(id, body) {
      return (await call<BalanceTransaction>(
        `/api/admin/customers/${encId(id)}/balance`,
        'POST',
        body,
      )) as BalanceTransaction;
    },
    async impersonate(id) {
      return (await call<ImpersonationResult>(
        `/api/admin/customers/${encId(id)}/impersonate`,
        'POST',
      )) as ImpersonationResult;
    },
  };
}

export const adminClient = createAdminClient();
