import { describe, it, expect, vi } from 'vitest';
import { createAdminClient, ApiError } from './api';

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

  it('impersonate POSTs and returns swapped user envelope', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          user: { id: 'c1', email: 'target@b.co', impersonated_by: 'admin-1' },
        },
      },
    ]);
    const client = createAdminClient({ fetch });
    const res = await client.impersonate('c1');
    expect(res.user.id).toBe('c1');
    expect(res.user.impersonated_by).toBe('admin-1');
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

  it('encodes customer id in every path', async () => {
    const { fetch, calls } = mockFetch([
      { body: { id: 'a/b', email: 'x', plan_id: 'p', balance_cents: 0, account_count: 0 } },
      { body: { user: { id: 'a/b', email: 'x' } } },
    ]);
    const client = createAdminClient({ fetch });
    await client.getCustomer('a/b');
    await client.impersonate('a/b');
    expect(calls[0].url).toBe('/api/admin/customers/a%2Fb');
    expect(calls[1].url).toBe('/api/admin/customers/a%2Fb/impersonate');
  });
});
