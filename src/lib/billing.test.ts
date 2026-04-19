import { describe, it, expect, vi } from 'vitest';
import { createBillingClient, ApiError } from './api';

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

describe('billing client', () => {
  it('createCheckoutSession POSTs amount_cents and returns redirect url', async () => {
    const { fetch, calls } = mockFetch([
      { body: { url: 'https://checkout.stripe.com/c/sess_123', session_id: 'sess_123' } },
    ]);
    const client = createBillingClient({ fetch });
    const sess = await client.createCheckoutSession(5000);
    expect(sess.url).toMatch(/checkout\.stripe\.com/);
    expect(sess.session_id).toBe('sess_123');
    expect(calls[0].url).toBe('/api/customer/billing/checkout');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.amount_cents).toBe(5000);
  });

  it('listTransactions paginates reverse-chronologically with cursor', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          transactions: [
            {
              id: 'tx3',
              type: 'credit',
              amount_cents: 5000,
              reason: 'stripe_topup',
              created_at: '2026-04-19T10:00:00Z',
            },
            {
              id: 'tx2',
              type: 'debit',
              amount_cents: 2900,
              reason: 'plan_fee',
              created_at: '2026-04-01T00:00:00Z',
            },
          ],
          next_cursor: 'cur-1',
        },
      },
      {
        body: {
          transactions: [
            {
              id: 'tx1',
              type: 'credit',
              amount_cents: 10000,
              reason: 'crypto_topup',
              description: 'BTC tx abc',
              created_at: '2026-03-15T00:00:00Z',
            },
          ],
          next_cursor: null,
        },
      },
    ]);
    const client = createBillingClient({ fetch });
    const p1 = await client.listTransactions({ limit: 25 });
    expect(p1.transactions.map((t) => t.id)).toEqual(['tx3', 'tx2']);
    expect(p1.next_cursor).toBe('cur-1');
    expect(calls[0].url).toBe('/api/customer/billing/transactions?limit=25');

    const p2 = await client.listTransactions({ limit: 25, cursor: p1.next_cursor });
    expect(p2.transactions.map((t) => t.id)).toEqual(['tx1']);
    expect(p2.next_cursor).toBeNull();
    expect(calls[1].url).toBe(
      '/api/customer/billing/transactions?limit=25&cursor=cur-1',
    );
  });

  it('listPaymentMethods unwraps envelope', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          payment_methods: [
            {
              id: 'pm_1',
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2028,
              is_default: true,
            },
          ],
        },
      },
    ]);
    const client = createBillingClient({ fetch });
    const pms = await client.listPaymentMethods();
    expect(pms).toHaveLength(1);
    expect(pms[0]).toMatchObject({ brand: 'visa', last4: '4242', is_default: true });
    expect(calls[0].url).toBe('/api/customer/billing/payment-methods');
    expect(calls[0].init.method).toBe('GET');
  });

  it('deletePaymentMethod DELETEs and tolerates 204', async () => {
    const { fetch, calls } = mockFetch([
      { status: 204, statusText: 'No Content', body: undefined },
    ]);
    const client = createBillingClient({ fetch });
    await expect(client.deletePaymentMethod('pm_1')).resolves.toBeUndefined();
    expect(calls[0].url).toBe('/api/customer/billing/payment-methods/pm_1');
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('setDefaultPaymentMethod POSTs to /default and returns updated PM', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 'pm_2',
          brand: 'mastercard',
          last4: '0001',
          exp_month: 6,
          exp_year: 2027,
          is_default: true,
        },
      },
    ]);
    const client = createBillingClient({ fetch });
    const pm = await client.setDefaultPaymentMethod('pm_2');
    expect(pm.is_default).toBe(true);
    expect(calls[0].url).toBe('/api/customer/billing/payment-methods/pm_2/default');
    expect(calls[0].init.method).toBe('POST');
  });

  it('404 on checkout throws typed ApiError with code', async () => {
    const { fetch } = mockFetch([
      { status: 402, statusText: 'Payment Required', body: { error: 'bad amount', code: 'bad_amount' } },
    ]);
    const client = createBillingClient({ fetch });
    const err = await client.createCheckoutSession(10).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 402, message: 'bad amount', code: 'bad_amount' });
  });

  it('encodes payment method id in path segments', async () => {
    const { fetch, calls } = mockFetch([
      { status: 204, statusText: 'No Content', body: undefined },
    ]);
    const client = createBillingClient({ fetch });
    await client.deletePaymentMethod('pm/with/slash');
    expect(calls[0].url).toBe(
      '/api/customer/billing/payment-methods/pm%2Fwith%2Fslash',
    );
  });
});
