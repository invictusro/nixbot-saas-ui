import type { AccountRecord, PlanSummary } from './stores';
import { accessToken, createApiFetch, userFromToken, type ApiFetch, type User } from './auth';

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

async function jsonCall<T>(
  api: ApiFetch,
  path: string,
  method: string,
  body?: unknown,
): Promise<T | null> {
  const init: RequestInit & { skipAuth?: boolean; skipRefresh?: boolean } = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await api(path, init);
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

export function createAccountsClient(opts: ApiClientOptions = {}): AccountsClient {
  const api = createApiFetch(opts);
  const call = <T>(path: string, method: string, body?: unknown) =>
    jsonCall<T>(api, path, method, body);

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
  const api = createApiFetch(opts);
  const call = <T>(path: string, method: string, body?: unknown) =>
    jsonCall<T>(api, path, method, body);

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

export type CustomerOrderState =
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface CustomerOrderRow {
  id: string;
  created_at: string;
  sku_code: string;
  sku_name: string;
  state: CustomerOrderState;
  posts_total: number;
  posts_done: number;
  source_brand: string;
}

export interface CustomerOrdersPage {
  orders: CustomerOrderRow[];
}

export type CustomerDeliveryState = 'posted' | 'failed' | 'missing';

export interface CustomerOrderDelivery {
  id: string;
  posted_at: string;
  state: CustomerDeliveryState;
  ig_post_url?: string | null;
}

export interface CustomerOrderDetail {
  id: string;
  created_at: string;
  completed_at?: string | null;
  sku_code: string;
  sku_name: string;
  state: CustomerOrderState;
  posts_total: number;
  posts_done: number;
  source_brand: string;
  deliveries: CustomerOrderDelivery[];
}

export interface CustomerOrderCancelResult {
  order_id: string;
  state: string;
  refunded: boolean;
  amount_cents?: number;
  transaction_id?: string;
}

export interface CustomerOrdersClient {
  list(): Promise<CustomerOrderRow[]>;
  get(id: string): Promise<CustomerOrderDetail>;
  cancel(id: string): Promise<CustomerOrderCancelResult>;
}

export function createCustomerOrdersClient(
  opts: ApiClientOptions = {},
): CustomerOrdersClient {
  const api = createApiFetch(opts);
  const call = <T>(path: string, method: string, body?: unknown) =>
    jsonCall<T>(api, path, method, body);

  return {
    async list() {
      const res = (await call<CustomerOrdersPage>('/api/customer/orders', 'GET')) as CustomerOrdersPage;
      return res.orders ?? [];
    },
    async get(id) {
      const res = (await call<CustomerOrderDetail>(
        `/api/customer/orders/${encId(id)}`,
        'GET',
      )) as CustomerOrderDetail;
      return { ...res, deliveries: res.deliveries ?? [] };
    },
    async cancel(id) {
      return (await call<CustomerOrderCancelResult>(
        `/api/customer/orders/${encId(id)}/cancel`,
        'POST',
      )) as CustomerOrderCancelResult;
    },
  };
}

export const customerOrdersClient = createCustomerOrdersClient();

export type CustomerSubscriptionState =
  | 'pending_activation'
  | 'active'
  | 'paused'
  | 'pending_cancellation'
  | 'cancelled'
  | 'expired';

export interface CustomerSubscriptionRow {
  id: string;
  created_at: string;
  sku_code: string;
  sku_name: string;
  state: CustomerSubscriptionState;
  next_renewal_at?: string | null;
  monthly_price_cents: number;
  source_brand: string;
}

export interface CustomerSubscriptionsPage {
  subscriptions: CustomerSubscriptionRow[];
}

export interface CustomerSubscriptionAssignment {
  id: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
  next_post_at?: string | null;
  pending_creation: boolean;
}

export interface CustomerSubscriptionDetail {
  id: string;
  created_at: string;
  sku_code: string;
  sku_name: string;
  state: CustomerSubscriptionState;
  started_at?: string | null;
  next_renewal_at?: string | null;
  last_renewed_at?: string | null;
  monthly_price_cents: number;
  source_brand: string;
  account_count?: number | null;
  posts_per_week?: number | null;
  cancel_at_cycle?: number | null;
  assignments: CustomerSubscriptionAssignment[];
}

export interface CustomerSubscriptionAccountDelivery {
  id: string;
  posted_at: string;
  state: 'posted' | 'failed' | 'missing';
  ig_post_url?: string | null;
}

export interface CustomerSubscriptionAccountDrill {
  assignment_id: string;
  subscription_id: string;
  sku_code: string;
  sku_name: string;
  source_brand: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
  next_post_at?: string | null;
  posts_total: number;
  posts_posted: number;
  posts_failed: number;
  deliveries: CustomerSubscriptionAccountDelivery[];
}

export interface CustomerSubscriptionCancelResult {
  subscription_id: string;
  state: string;
  ends_at?: string | null;
}

export interface CustomerSubscriptionsClient {
  list(): Promise<CustomerSubscriptionRow[]>;
  get(id: string): Promise<CustomerSubscriptionDetail>;
  getAccount(
    subscriptionId: string,
    accountId: string,
  ): Promise<CustomerSubscriptionAccountDrill>;
  cancel(id: string): Promise<CustomerSubscriptionCancelResult>;
}

export function createCustomerSubscriptionsClient(
  opts: ApiClientOptions = {},
): CustomerSubscriptionsClient {
  const api = createApiFetch(opts);
  const call = <T>(path: string, method: string, body?: unknown) =>
    jsonCall<T>(api, path, method, body);

  return {
    async list() {
      const res = (await call<CustomerSubscriptionsPage>(
        '/api/customer/subscriptions',
        'GET',
      )) as CustomerSubscriptionsPage;
      return res.subscriptions ?? [];
    },
    async get(id) {
      const res = (await call<CustomerSubscriptionDetail>(
        `/api/customer/subscriptions/${encId(id)}`,
        'GET',
      )) as CustomerSubscriptionDetail;
      return { ...res, assignments: res.assignments ?? [] };
    },
    async getAccount(subscriptionId, accountId) {
      const res = (await call<CustomerSubscriptionAccountDrill>(
        `/api/customer/subscriptions/${encId(subscriptionId)}/accounts/${encId(accountId)}`,
        'GET',
      )) as CustomerSubscriptionAccountDrill;
      return { ...res, deliveries: res.deliveries ?? [] };
    },
    async cancel(id) {
      return (await call<CustomerSubscriptionCancelResult>(
        `/api/customer/subscriptions/${encId(id)}/cancel`,
        'POST',
      )) as CustomerSubscriptionCancelResult;
    },
  };
}

export const customerSubscriptionsClient = createCustomerSubscriptionsClient();

export interface AdminCustomerRow {
  id: string;
  email: string;
  plan_id: string;
  plan_name?: string;
  balance_cents: number;
  account_count: number;
  source_brand?: string | null;
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

export type AdminOrderState =
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface AdminOrderRow {
  id: string;
  created_at: string;
  customer_email: string;
  source_brand: string;
  sku_code: string;
  state: AdminOrderState;
  posts_done: number;
  posts_total: number;
  started_by?: string | null;
}

export interface AdminOrdersPage {
  orders: AdminOrderRow[];
  next_offset?: number | null;
}

export interface AdminOrdersListOpts {
  state?: AdminOrderState;
  source_brand?: string;
  sort_by?: 'created_at' | 'state';
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AdminOrderDetail {
  id: string;
  customer_id: string;
  customer_email: string;
  sku_id: string;
  sku_code: string;
  sku_metadata_json: Record<string, unknown>;
  source_brand: string;
  state: AdminOrderState;
  posts_total: number;
  posts_done: number;
  posts_per_day?: number | null;
  active_hours_start?: number | null;
  active_hours_end?: number | null;
  account_pool_filter_json: Record<string, unknown>;
  started_by?: string | null;
  started_at?: string | null;
  created_at: string;
  completed_at?: string | null;
  last_post_at?: string | null;
}

export interface AdminOrderStartOpts {
  posts_per_day?: number;
  active_hours_start?: number;
  active_hours_end?: number;
  account_pool_filter_json?: Record<string, unknown>;
}

export interface AdminOrderStartResult {
  order_id: string;
  state: string;
}

export interface AdminOrderPoolPreviewOpts {
  account_pool_filter_json?: Record<string, unknown>;
  posts_per_day?: number;
}

export interface AdminOrderPoolPreview {
  matching_accounts_count: number;
  estimated_completion_days: number | null;
}

export interface AdminOrderCancelResult {
  order_id: string;
  state: string;
  refunded: boolean;
  amount_cents?: number;
  transaction_id?: string;
}

export type AdminSubscriptionState =
  | 'pending_activation'
  | 'active'
  | 'paused'
  | 'pending_cancellation'
  | 'cancelled'
  | 'expired';

export interface AdminSubscriptionRow {
  id: string;
  created_at: string;
  customer_email: string;
  source_brand: string;
  sku_code: string;
  state: AdminSubscriptionState;
  next_renewal_at?: string | null;
  active_assignments: number;
  required_account_count?: number | null;
}

export interface AdminSubscriptionsPage {
  subscriptions: AdminSubscriptionRow[];
  next_offset?: number | null;
}

export interface AdminSubscriptionsListOpts {
  state?: AdminSubscriptionState;
  source_brand?: string;
  sort_by?: 'created_at' | 'next_renewal_at' | 'state';
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AdminSubscriptionAssignment {
  id: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
  pending_creation: boolean;
}

export interface AdminSubscriptionDetail {
  id: string;
  created_at: string;
  customer_id: string;
  customer_email: string;
  sku_id: string;
  sku_code: string;
  sku_metadata_json: Record<string, unknown>;
  source_brand: string;
  state: AdminSubscriptionState;
  required_account_count?: number | null;
  started_at?: string | null;
  next_renewal_at?: string | null;
  last_renewed_at?: string | null;
  activated_by?: string | null;
  cancel_at_cycle?: number | null;
  metadata_json: Record<string, unknown>;
  assignments: AdminSubscriptionAssignment[];
}

export interface AdminSubscriptionAllocateOpts {
  account_ids: string[];
  start_warmup?: boolean;
}

export interface IdleOperatorAccount {
  id: string;
  username: string;
  niche?: string | null;
  status: string;
  warmup_days: number;
  posting_enabled: boolean;
}

export interface IdleOperatorAccountsPage {
  accounts: IdleOperatorAccount[];
}

export interface IdleOperatorAccountsListOpts {
  niche?: string;
  limit?: number;
}

export interface AdminSubscriptionAllocateResult {
  subscription_id: string;
  assignments: { id: string; account_id: string }[];
}

export interface AdminSubscriptionCreateAccountsOpts {
  count: number;
}

export interface AdminSubscriptionCreateAccountsResult {
  subscription_id: string;
  assignments: { id: string; pending_creation: boolean }[];
  jobs_enqueued: number;
}

export interface AdminSubscriptionActionResult {
  subscription_id: string;
  state: string;
}

export type AdminRevenueTimeframeDays = 7 | 30 | 90;

export interface AdminRevenueBrand {
  brand_code: string;
  total_customers: number;
  active_orders: number;
  active_subscriptions: number;
  mrr_cents: number;
  revenue_cents: number;
}

export interface AdminRevenueResponse {
  timeframe_days: AdminRevenueTimeframeDays;
  brands: AdminRevenueBrand[];
}

export interface AdminCatalogOffering {
  id: string;
  sku_id: string;
  brand_code: string;
  price_cents: number;
  stripe_price_id: string;
  active: boolean;
  created_at: string;
}

export interface AdminCatalogSKU {
  id: string;
  product_id: string;
  code: string;
  billing_type: 'one_shot' | 'recurring_monthly';
  recurring_interval_months: number | null;
  metadata_json: Record<string, unknown>;
  active: boolean;
  created_at: string;
  offerings: AdminCatalogOffering[];
}

export interface AdminCatalogPage {
  items: AdminCatalogSKU[];
  limit: number;
  offset: number;
  total: number;
}

export interface AdminCatalogCreateOfferingOpts {
  sku_id: string;
  brand_code: string;
  price_cents: number;
  stripe_price_id?: string;
}

export interface AdminClient {
  listCustomers(opts?: {
    limit?: number;
    cursor?: string | null;
    query?: string;
    source_brand?: string;
  }): Promise<AdminCustomersPage>;
  getRevenue(opts?: { timeframe_days?: AdminRevenueTimeframeDays }): Promise<AdminRevenueResponse>;
  getCustomer(id: string): Promise<AdminCustomerDetail>;
  adjustBalance(id: string, body: AdminBalanceAdjustment): Promise<BalanceTransaction>;
  impersonate(id: string, opts?: { email?: string }): Promise<User>;
  listOrders(opts?: AdminOrdersListOpts): Promise<AdminOrdersPage>;
  getOrder(id: string): Promise<AdminOrderDetail>;
  startOrder(id: string, opts?: AdminOrderStartOpts): Promise<AdminOrderStartResult>;
  pauseOrder(id: string): Promise<AdminOrderStartResult>;
  resumeOrder(id: string): Promise<AdminOrderStartResult>;
  cancelOrder(id: string, opts?: { refund?: boolean }): Promise<AdminOrderCancelResult>;
  previewOrderPool(id: string, opts?: AdminOrderPoolPreviewOpts): Promise<AdminOrderPoolPreview>;
  listSubscriptions(opts?: AdminSubscriptionsListOpts): Promise<AdminSubscriptionsPage>;
  getSubscription(id: string): Promise<AdminSubscriptionDetail>;
  allocateSubscriptionAccounts(
    id: string,
    opts: AdminSubscriptionAllocateOpts,
  ): Promise<AdminSubscriptionAllocateResult>;
  createSubscriptionAccounts(
    id: string,
    opts: AdminSubscriptionCreateAccountsOpts,
  ): Promise<AdminSubscriptionCreateAccountsResult>;
  activateSubscription(id: string): Promise<AdminSubscriptionActionResult>;
  pauseSubscription(id: string): Promise<AdminSubscriptionActionResult>;
  resumeSubscription(id: string): Promise<AdminSubscriptionActionResult>;
  cancelSubscription(id: string): Promise<AdminSubscriptionActionResult>;
  listIdleOperatorAccounts(
    opts?: IdleOperatorAccountsListOpts,
  ): Promise<IdleOperatorAccountsPage>;
  listCatalogSKUs(opts?: { limit?: number; offset?: number }): Promise<AdminCatalogPage>;
  createOffering(opts: AdminCatalogCreateOfferingOpts): Promise<AdminCatalogOffering>;
  updateOfferingPrice(id: string, priceCents: number): Promise<AdminCatalogOffering>;
}

export function createAdminClient(opts: ApiClientOptions = {}): AdminClient {
  const api = createApiFetch(opts);
  const call = <T>(path: string, method: string, body?: unknown) =>
    jsonCall<T>(api, path, method, body);

  return {
    async listCustomers(opts = {}) {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.cursor) params.set('cursor', opts.cursor);
      if (opts.query) params.set('q', opts.query);
      if (opts.source_brand) params.set('source_brand', opts.source_brand);
      const qs = params.toString();
      const path = '/api/admin/customers' + (qs ? `?${qs}` : '');
      return (await call<AdminCustomersPage>(path, 'GET')) as AdminCustomersPage;
    },
    async getRevenue(opts = {}) {
      const params = new URLSearchParams();
      if (opts.timeframe_days !== undefined) {
        params.set('timeframe_days', String(opts.timeframe_days));
      }
      const qs = params.toString();
      const path = '/api/admin/revenue' + (qs ? `?${qs}` : '');
      const res = (await call<AdminRevenueResponse>(path, 'GET')) as AdminRevenueResponse;
      return { ...res, brands: res.brands ?? [] };
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
    async impersonate(id, opts) {
      const data = (await call<{ access_token: string }>(
        `/api/admin/customers/${encId(id)}/impersonate`,
        'POST',
      )) as { access_token: string };
      accessToken.set(data.access_token);
      return userFromToken(data.access_token, opts?.email);
    },
    async listOrders(opts = {}) {
      const params = new URLSearchParams();
      if (opts.state) params.set('state', opts.state);
      if (opts.source_brand) params.set('source_brand', opts.source_brand);
      if (opts.sort_by) params.set('sort_by', opts.sort_by);
      if (opts.sort_dir) params.set('sort_dir', opts.sort_dir);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.offset !== undefined) params.set('offset', String(opts.offset));
      const qs = params.toString();
      const path = '/api/admin/orders' + (qs ? `?${qs}` : '');
      return (await call<AdminOrdersPage>(path, 'GET')) as AdminOrdersPage;
    },
    async getOrder(id) {
      return (await call<AdminOrderDetail>(
        `/api/admin/orders/${encId(id)}`,
        'GET',
      )) as AdminOrderDetail;
    },
    async startOrder(id, opts = {}) {
      const body: Record<string, unknown> = {};
      if (opts.posts_per_day !== undefined) body.posts_per_day = opts.posts_per_day;
      if (opts.active_hours_start !== undefined) body.active_hours_start = opts.active_hours_start;
      if (opts.active_hours_end !== undefined) body.active_hours_end = opts.active_hours_end;
      if (opts.account_pool_filter_json !== undefined) {
        body.account_pool_filter_json = opts.account_pool_filter_json;
      }
      const hasBody = Object.keys(body).length > 0;
      return (await call<AdminOrderStartResult>(
        `/api/admin/orders/${encId(id)}/start`,
        'POST',
        hasBody ? body : undefined,
      )) as AdminOrderStartResult;
    },
    async pauseOrder(id) {
      return (await call<AdminOrderStartResult>(
        `/api/admin/orders/${encId(id)}/pause`,
        'POST',
      )) as AdminOrderStartResult;
    },
    async resumeOrder(id) {
      return (await call<AdminOrderStartResult>(
        `/api/admin/orders/${encId(id)}/resume`,
        'POST',
      )) as AdminOrderStartResult;
    },
    async cancelOrder(id, opts = {}) {
      const body: Record<string, unknown> = {};
      if (opts.refund !== undefined) body.refund = opts.refund;
      const hasBody = Object.keys(body).length > 0;
      return (await call<AdminOrderCancelResult>(
        `/api/admin/orders/${encId(id)}/cancel`,
        'POST',
        hasBody ? body : undefined,
      )) as AdminOrderCancelResult;
    },
    async previewOrderPool(id, opts = {}) {
      const body: Record<string, unknown> = {};
      if (opts.account_pool_filter_json !== undefined) {
        body.account_pool_filter_json = opts.account_pool_filter_json;
      }
      if (opts.posts_per_day !== undefined) body.posts_per_day = opts.posts_per_day;
      return (await call<AdminOrderPoolPreview>(
        `/api/admin/orders/${encId(id)}/pool-preview`,
        'POST',
        body,
      )) as AdminOrderPoolPreview;
    },
    async listSubscriptions(opts = {}) {
      const params = new URLSearchParams();
      if (opts.state) params.set('state', opts.state);
      if (opts.source_brand) params.set('source_brand', opts.source_brand);
      if (opts.sort_by) params.set('sort_by', opts.sort_by);
      if (opts.sort_dir) params.set('sort_dir', opts.sort_dir);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.offset !== undefined) params.set('offset', String(opts.offset));
      const qs = params.toString();
      const path = '/api/admin/subscriptions' + (qs ? `?${qs}` : '');
      return (await call<AdminSubscriptionsPage>(path, 'GET')) as AdminSubscriptionsPage;
    },
    async getSubscription(id) {
      return (await call<AdminSubscriptionDetail>(
        `/api/admin/subscriptions/${encId(id)}`,
        'GET',
      )) as AdminSubscriptionDetail;
    },
    async allocateSubscriptionAccounts(id, opts) {
      const body: Record<string, unknown> = { account_ids: opts.account_ids };
      if (opts.start_warmup !== undefined) body.start_warmup = opts.start_warmup;
      return (await call<AdminSubscriptionAllocateResult>(
        `/api/admin/subscriptions/${encId(id)}/allocate-accounts`,
        'POST',
        body,
      )) as AdminSubscriptionAllocateResult;
    },
    async createSubscriptionAccounts(id, opts) {
      return (await call<AdminSubscriptionCreateAccountsResult>(
        `/api/admin/subscriptions/${encId(id)}/create-accounts`,
        'POST',
        { count: opts.count },
      )) as AdminSubscriptionCreateAccountsResult;
    },
    async activateSubscription(id) {
      return (await call<AdminSubscriptionActionResult>(
        `/api/admin/subscriptions/${encId(id)}/activate`,
        'POST',
      )) as AdminSubscriptionActionResult;
    },
    async pauseSubscription(id) {
      return (await call<AdminSubscriptionActionResult>(
        `/api/admin/subscriptions/${encId(id)}/pause`,
        'POST',
      )) as AdminSubscriptionActionResult;
    },
    async resumeSubscription(id) {
      return (await call<AdminSubscriptionActionResult>(
        `/api/admin/subscriptions/${encId(id)}/resume`,
        'POST',
      )) as AdminSubscriptionActionResult;
    },
    async cancelSubscription(id) {
      return (await call<AdminSubscriptionActionResult>(
        `/api/admin/subscriptions/${encId(id)}/cancel`,
        'POST',
      )) as AdminSubscriptionActionResult;
    },
    async listIdleOperatorAccounts(opts = {}) {
      const params = new URLSearchParams();
      if (opts.niche) params.set('niche', opts.niche);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString();
      const path = '/api/admin/operator-accounts/idle' + (qs ? `?${qs}` : '');
      return (await call<IdleOperatorAccountsPage>(path, 'GET')) as IdleOperatorAccountsPage;
    },
    async listCatalogSKUs(opts = {}) {
      const params = new URLSearchParams();
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.offset !== undefined) params.set('offset', String(opts.offset));
      const qs = params.toString();
      const path = '/api/admin/skus' + (qs ? `?${qs}` : '');
      const page = (await call<AdminCatalogPage>(path, 'GET')) as AdminCatalogPage;
      return {
        ...page,
        items: (page.items ?? []).map((it) => ({ ...it, offerings: it.offerings ?? [] })),
      };
    },
    async createOffering(opts) {
      const body: Record<string, unknown> = {
        sku_id: opts.sku_id,
        brand_code: opts.brand_code,
        price_cents: opts.price_cents,
      };
      if (opts.stripe_price_id) body.stripe_price_id = opts.stripe_price_id;
      return (await call<AdminCatalogOffering>(
        '/api/admin/sku-offerings',
        'POST',
        body,
      )) as AdminCatalogOffering;
    },
    async updateOfferingPrice(id, priceCents) {
      return (await call<AdminCatalogOffering>(
        `/api/admin/sku-offerings/${encId(id)}`,
        'PATCH',
        { price_cents: priceCents },
      )) as AdminCatalogOffering;
    },
  };
}

export const adminClient = createAdminClient();
