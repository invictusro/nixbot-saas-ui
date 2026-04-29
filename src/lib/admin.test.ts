import { describe, it, expect, vi } from 'vitest';
import { createAdminClient, ApiError } from './api';
import { accessToken } from './auth';

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const exp = Math.floor(Date.now() / 1000) + 900;
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ ...payload, exp })}.sig`;
}

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(
  responses: Array<Partial<Response> & { body?: unknown }>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no mock response queued');
    const status = next.status ?? 200;
    const noBody = status === 204 || status === 205 || status === 304;
    const bodyStr = noBody ? null : JSON.stringify(next.body ?? {});
    return new Response(bodyStr, {
      status,
      statusText: next.statusText ?? 'OK',
      headers: noBody ? undefined : { 'content-type': 'application/json' },
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe('admin client', () => {
  it('listCustomers GETs /api/admin/customers with query params', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          customers: [
            {
              id: 'c1',
              email: 'a@b.co',
              plan_id: 'p-standard',
              plan_name: 'Standard',
              balance_cents: 1000,
              account_count: 2,
            },
          ],
          next_cursor: 'cur-1',
        },
      },
    ]);
    const client = createAdminClient({ fetch, baseUrl: 'http://x' });
    const page = await client.listCustomers({ limit: 25, query: 'acme' });
    expect(page.customers).toHaveLength(1);
    expect(page.next_cursor).toBe('cur-1');
    expect(calls[0].url).toBe('http://x/api/admin/customers?limit=25&q=acme');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('listCustomers paginates with cursor', async () => {
    const { fetch, calls } = mockFetch([
      { body: { customers: [], next_cursor: null } },
    ]);
    const client = createAdminClient({ fetch });
    await client.listCustomers({ limit: 10, cursor: 'cur-1' });
    expect(calls[0].url).toBe('/api/admin/customers?limit=10&cursor=cur-1');
  });

  it('getCustomer returns detail envelope', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 'c1',
          email: 'a@b.co',
          plan_id: 'p-standard',
          balance_cents: 500,
          account_count: 1,
          accounts: [{ id: 'a1', status: 'active' }],
          transactions: [{ id: 't1', type: 'credit', amount_cents: 500, reason: 'stripe_topup', created_at: '2026-04-19T00:00:00Z' }],
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const d = await client.getCustomer('c1');
    expect(d.email).toBe('a@b.co');
    expect(d.accounts?.[0].id).toBe('a1');
    expect(d.transactions?.[0].reason).toBe('stripe_topup');
    expect(calls[0].url).toBe('/api/admin/customers/c1');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('adjustBalance POSTs JSON to /balance', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 't-new',
          type: 'credit',
          amount_cents: 2500,
          reason: 'crypto_topup',
          description: 'BTC tx abc',
          created_at: '2026-04-19T12:00:00Z',
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const txn = await client.adjustBalance('c1', {
      type: 'credit',
      amount_cents: 2500,
      reason: 'crypto_topup',
      description: 'BTC tx abc',
    });
    expect(txn.amount_cents).toBe(2500);
    expect(calls[0].url).toBe('/api/admin/customers/c1/balance');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toEqual({
      type: 'credit',
      amount_cents: 2500,
      reason: 'crypto_topup',
      description: 'BTC tx abc',
    });
  });

  it('impersonate POSTs, swaps in-memory token, returns target user with admin attribution', async () => {
    const targetToken = fakeJwt({ user_id: 'c1', impersonated_by: 'admin-1' });
    const { fetch, calls } = mockFetch([
      { body: { access_token: targetToken, expires_in: 900, token_type: 'Bearer' } },
    ]);
    const client = createAdminClient({ fetch });
    const user = await client.impersonate('c1', { email: 'target@b.co' });
    expect(user.id).toBe('c1');
    expect(user.email).toBe('target@b.co');
    expect(user.impersonated_by).toBe('admin-1');
    expect(accessToken.get()).toBe(targetToken);
    expect(calls[0].url).toBe('/api/admin/customers/c1/impersonate');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.credentials).toBe('include');
  });

  it('non-admin caller surfaces typed 403 ApiError', async () => {
    const { fetch } = mockFetch([
      { status: 403, statusText: 'Forbidden', body: { error: 'not admin', code: 'forbidden' } },
    ]);
    const client = createAdminClient({ fetch });
    const err = await client.listCustomers().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('listOrders GETs /api/admin/orders with all filter params', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          orders: [
            {
              id: 'o1',
              created_at: '2026-04-26T10:00:00Z',
              customer_email: 'a@b.co',
              source_brand: 'nixbot',
              sku_code: 'reels-10',
              state: 'pending',
              posts_done: 0,
              posts_total: 10,
            },
          ],
          next_offset: 50,
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const page = await client.listOrders({
      state: 'pending',
      source_brand: 'nixbot',
      sort_by: 'created_at',
      sort_dir: 'desc',
      limit: 25,
      offset: 0,
    });
    expect(page.orders).toHaveLength(1);
    expect(page.orders[0].state).toBe('pending');
    expect(page.next_offset).toBe(50);
    const url = new URL(calls[0].url, 'http://x');
    expect(url.pathname).toBe('/api/admin/orders');
    expect(url.searchParams.get('state')).toBe('pending');
    expect(url.searchParams.get('source_brand')).toBe('nixbot');
    expect(url.searchParams.get('sort_by')).toBe('created_at');
    expect(url.searchParams.get('sort_dir')).toBe('desc');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(calls[0].init.method).toBe('GET');
  });

  it('listOrders with no opts hits bare path', async () => {
    const { fetch, calls } = mockFetch([{ body: { orders: [] } }]);
    const client = createAdminClient({ fetch });
    const page = await client.listOrders();
    expect(page.orders).toEqual([]);
    expect(calls[0].url).toBe('/api/admin/orders');
  });

  it('getOrder GETs /api/admin/orders/:id', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 'o-1',
          customer_id: 'c-1',
          customer_email: 'a@b.co',
          sku_id: 's-1',
          sku_code: 'reels-10',
          sku_metadata_json: { reel_count: 10 },
          source_brand: 'nixbot',
          state: 'pending',
          posts_total: 10,
          posts_done: 0,
          account_pool_filter_json: {},
          created_at: '2026-04-26T10:00:00Z',
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const d = await client.getOrder('o-1');
    expect(d.sku_code).toBe('reels-10');
    expect(d.sku_metadata_json).toEqual({ reel_count: 10 });
    expect(calls[0].url).toBe('/api/admin/orders/o-1');
    expect(calls[0].init.method).toBe('GET');
  });

  it('startOrder POSTs config body to /api/admin/orders/:id/start', async () => {
    const { fetch, calls } = mockFetch([
      { body: { order_id: 'o-1', state: 'active' } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.startOrder('o-1', {
      posts_per_day: 2,
      active_hours_start: 9,
      active_hours_end: 21,
      account_pool_filter_json: { min_warmup_days: 5 },
    });
    expect(res.state).toBe('active');
    expect(calls[0].url).toBe('/api/admin/orders/o-1/start');
    expect(calls[0].init.method).toBe('POST');
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toEqual({
      posts_per_day: 2,
      active_hours_start: 9,
      active_hours_end: 21,
      account_pool_filter_json: { min_warmup_days: 5 },
    });
  });

  it('startOrder with no opts sends empty body', async () => {
    const { fetch, calls } = mockFetch([
      { body: { order_id: 'o-1', state: 'active' } },
    ]);
    const client = createAdminClient({ fetch });
    await client.startOrder('o-1');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('previewOrderPool POSTs filter+cadence body to /pool-preview', async () => {
    const { fetch, calls } = mockFetch([
      { body: { matching_accounts_count: 7, estimated_completion_days: 12 } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.previewOrderPool('o-1', {
      account_pool_filter_json: { min_warmup_days: 14, niche: 'fitness' },
      posts_per_day: 4,
    });
    expect(res.matching_accounts_count).toBe(7);
    expect(res.estimated_completion_days).toBe(12);
    expect(calls[0].url).toBe('/api/admin/orders/o-1/pool-preview');
    expect(calls[0].init.method).toBe('POST');
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toEqual({
      account_pool_filter_json: { min_warmup_days: 14, niche: 'fitness' },
      posts_per_day: 4,
    });
  });

  it('previewOrderPool with empty filter still POSTs an empty-object body', async () => {
    const { fetch, calls } = mockFetch([
      { body: { matching_accounts_count: 0, estimated_completion_days: null } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.previewOrderPool('o-1', {
      account_pool_filter_json: {},
    });
    expect(res.estimated_completion_days).toBeNull();
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toEqual({ account_pool_filter_json: {} });
  });

  it('pauseOrder POSTs empty body to /pause', async () => {
    const { fetch, calls } = mockFetch([
      { body: { order_id: 'o-1', state: 'paused' } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.pauseOrder('o-1');
    expect(res.state).toBe('paused');
    expect(calls[0].url).toBe('/api/admin/orders/o-1/pause');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('resumeOrder POSTs empty body to /resume', async () => {
    const { fetch, calls } = mockFetch([
      { body: { order_id: 'o-1', state: 'active' } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.resumeOrder('o-1');
    expect(res.state).toBe('active');
    expect(calls[0].url).toBe('/api/admin/orders/o-1/resume');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('cancelOrder POSTs refund flag and surfaces refund result', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          order_id: 'o-1',
          state: 'cancelled',
          refunded: true,
          amount_cents: 4999,
          transaction_id: 't-9',
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.cancelOrder('o-1', { refund: true });
    expect(res.refunded).toBe(true);
    expect(res.amount_cents).toBe(4999);
    expect(res.transaction_id).toBe('t-9');
    expect(calls[0].url).toBe('/api/admin/orders/o-1/cancel');
    expect(calls[0].init.method).toBe('POST');
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toEqual({ refund: true });
  });

  it('cancelOrder with no opts sends empty body', async () => {
    const { fetch, calls } = mockFetch([
      { body: { order_id: 'o-1', state: 'cancelled', refunded: false } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.cancelOrder('o-1');
    expect(res.refunded).toBe(false);
    expect(calls[0].init.body).toBeUndefined();
  });

  it('listSubscriptions GETs /api/admin/subscriptions with all filter params', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          subscriptions: [
            {
              id: 's1',
              created_at: '2026-04-26T10:00:00Z',
              customer_email: 'a@b.co',
              source_brand: 'nixbot',
              sku_code: 'managed-3',
              state: 'pending_activation',
              next_renewal_at: null,
              active_assignments: 0,
              required_account_count: 3,
            },
          ],
          next_offset: 50,
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const page = await client.listSubscriptions({
      state: 'pending_activation',
      source_brand: 'nixbot',
      sort_by: 'next_renewal_at',
      sort_dir: 'asc',
      limit: 25,
      offset: 0,
    });
    expect(page.subscriptions).toHaveLength(1);
    expect(page.subscriptions[0].state).toBe('pending_activation');
    expect(page.subscriptions[0].required_account_count).toBe(3);
    expect(page.next_offset).toBe(50);
    const url = new URL(calls[0].url, 'http://x');
    expect(url.pathname).toBe('/api/admin/subscriptions');
    expect(url.searchParams.get('state')).toBe('pending_activation');
    expect(url.searchParams.get('source_brand')).toBe('nixbot');
    expect(url.searchParams.get('sort_by')).toBe('next_renewal_at');
    expect(url.searchParams.get('sort_dir')).toBe('asc');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(calls[0].init.method).toBe('GET');
  });

  it('listSubscriptions with no opts hits bare path', async () => {
    const { fetch, calls } = mockFetch([{ body: { subscriptions: [] } }]);
    const client = createAdminClient({ fetch });
    const page = await client.listSubscriptions();
    expect(page.subscriptions).toEqual([]);
    expect(calls[0].url).toBe('/api/admin/subscriptions');
  });

  it('getSubscription GETs /api/admin/subscriptions/:id', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 's1',
          created_at: '2026-04-26T10:00:00Z',
          customer_id: 'c1',
          customer_email: 'x@y.co',
          sku_id: 'sk1',
          sku_code: 'managed-3',
          sku_metadata_json: { account_count: 3 },
          source_brand: 'nixbot',
          state: 'pending_activation',
          required_account_count: 3,
          metadata_json: {},
          assignments: [],
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const d = await client.getSubscription('s1');
    expect(d.sku_code).toBe('managed-3');
    expect(d.required_account_count).toBe(3);
    expect(calls[0].url).toBe('/api/admin/subscriptions/s1');
    expect(calls[0].init.method).toBe('GET');
  });

  it('allocateSubscriptionAccounts POSTs account_ids body', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          subscription_id: 's1',
          assignments: [{ id: 'a1', account_id: 'acc1' }],
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.allocateSubscriptionAccounts('s1', {
      account_ids: ['acc1'],
      start_warmup: true,
    });
    expect(res.assignments).toHaveLength(1);
    expect(calls[0].url).toBe('/api/admin/subscriptions/s1/allocate-accounts');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      account_ids: ['acc1'],
      start_warmup: true,
    });
  });

  it('activateSubscription POSTs to activate', async () => {
    const { fetch, calls } = mockFetch([
      { body: { subscription_id: 's1', state: 'active' } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.activateSubscription('s1');
    expect(res.state).toBe('active');
    expect(calls[0].url).toBe('/api/admin/subscriptions/s1/activate');
    expect(calls[0].init.method).toBe('POST');
  });

  it('cancelSubscription POSTs to cancel', async () => {
    const { fetch, calls } = mockFetch([
      { body: { subscription_id: 's1', state: 'pending_cancellation_or_cancelled' } },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.cancelSubscription('s1');
    expect(res.subscription_id).toBe('s1');
    expect(calls[0].url).toBe('/api/admin/subscriptions/s1/cancel');
  });

  it('listIdleOperatorAccounts GETs bare path with no opts', async () => {
    const { fetch, calls } = mockFetch([{ body: { accounts: [] } }]);
    const client = createAdminClient({ fetch });
    const page = await client.listIdleOperatorAccounts();
    expect(page.accounts).toEqual([]);
    expect(calls[0].url).toBe('/api/admin/operator-accounts/idle');
    expect(calls[0].init.method).toBe('GET');
  });

  it('createSubscriptionAccounts POSTs count body', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          subscription_id: 's1',
          assignments: [
            { id: 'p1', pending_creation: true },
            { id: 'p2', pending_creation: true },
            { id: 'p3', pending_creation: true },
          ],
          jobs_enqueued: 3,
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.createSubscriptionAccounts('s1', { count: 3 });
    expect(res.jobs_enqueued).toBe(3);
    expect(res.assignments).toHaveLength(3);
    expect(res.assignments[0].pending_creation).toBe(true);
    expect(calls[0].url).toBe('/api/admin/subscriptions/s1/create-accounts');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ count: 3 });
  });

  it('createSubscriptionAccounts encodes the subscription id', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: { subscription_id: 'a/b', assignments: [], jobs_enqueued: 0 },
      },
    ]);
    const client = createAdminClient({ fetch });
    await client.createSubscriptionAccounts('a/b', { count: 1 });
    expect(calls[0].url).toBe('/api/admin/subscriptions/a%2Fb/create-accounts');
  });

  it('listIdleOperatorAccounts forwards niche + limit query params', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          accounts: [
            {
              id: 'acc1',
              username: 'u1',
              niche: 'fitness',
              status: 'active',
              warmup_days: 5,
              posting_enabled: true,
            },
          ],
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const page = await client.listIdleOperatorAccounts({ niche: 'fitness', limit: 50 });
    expect(page.accounts).toHaveLength(1);
    expect(page.accounts[0].niche).toBe('fitness');
    expect(calls[0].url).toBe('/api/admin/operator-accounts/idle?niche=fitness&limit=50');
  });

  it('encodes customer id in every path', async () => {
    const { fetch, calls } = mockFetch([
      { body: { id: 'a/b', email: 'x', plan_id: 'p', balance_cents: 0, account_count: 0 } },
      { body: { access_token: fakeJwt({ user_id: 'a/b' }), expires_in: 900, token_type: 'Bearer' } },
    ]);
    const client = createAdminClient({ fetch });
    await client.getCustomer('a/b');
    await client.impersonate('a/b');
    expect(calls[0].url).toBe('/api/admin/customers/a%2Fb');
    expect(calls[1].url).toBe('/api/admin/customers/a%2Fb/impersonate');
  });
});
