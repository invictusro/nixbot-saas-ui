import { describe, it, expect, vi } from 'vitest';
import { createAccountsClient, ApiError } from './api';

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

describe('accounts client', () => {
  it('list returns accounts with credentials:include', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          accounts: [
            { id: 'a1', username: 'acme', status: 'active', last_action_at: '2026-04-19T10:00:00Z' },
          ],
        },
      },
    ]);
    const client = createAccountsClient({ fetch, baseUrl: 'http://x' });
    const list = await client.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a1', username: 'acme', status: 'active' });
    expect(calls[0].url).toBe('http://x/api/customer/accounts');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('pause POSTs to /pause and returns updated account', async () => {
    const { fetch, calls } = mockFetch([
      { body: { id: 'a1', username: 'acme', status: 'paused' } },
    ]);
    const client = createAccountsClient({ fetch });
    const updated = await client.pause('a1');
    expect(updated.status).toBe('paused');
    expect(calls[0].url).toBe('/api/customer/accounts/a1/pause');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.credentials).toBe('include');
  });

  it('resume hits /resume', async () => {
    const { fetch, calls } = mockFetch([
      { body: { id: 'a1', status: 'active' } },
    ]);
    const client = createAccountsClient({ fetch });
    const updated = await client.resume('a1');
    expect(updated.status).toBe('active');
    expect(calls[0].url).toBe('/api/customer/accounts/a1/resume');
    expect(calls[0].init.method).toBe('POST');
  });

  it('summary returns balance + plan', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          balance_cents: 4200,
          plan: { id: 'p-standard', name: 'Standard', max_accounts: 10, price_cents: 2900 },
          account_count: 3,
        },
      },
    ]);
    const client = createAccountsClient({ fetch });
    const s = await client.summary();
    expect(s.balance_cents).toBe(4200);
    expect(s.plan.max_accounts).toBe(10);
    expect(calls[0].url).toBe('/api/customer/summary');
  });

  it('non-ok response throws ApiError with parsed body', async () => {
    const { fetch } = mockFetch([
      { status: 403, statusText: 'Forbidden', body: { error: 'nope', code: 'forbidden' } },
    ]);
    const client = createAccountsClient({ fetch });
    const err = await client.list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, message: 'nope', code: 'forbidden' });
  });

  it('encodes account id in path', async () => {
    const { fetch, calls } = mockFetch([{ body: { id: 'a/b', status: 'paused' } }]);
    const client = createAccountsClient({ fetch });
    await client.pause('a/b');
    expect(calls[0].url).toBe('/api/customer/accounts/a%2Fb/pause');
  });

  it('get returns detail with settings', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 'a1',
          username: 'acme',
          status: 'ready',
          created_at: '2026-04-10T00:00:00Z',
          settings: {
            warmup: { preset: 'normal', daily_follows: 20 },
            posting: { preset: 'conservative', posts_per_day: 1 },
          },
        },
      },
    ]);
    const client = createAccountsClient({ fetch });
    const d = await client.get('a1');
    expect(d.settings.warmup.preset).toBe('normal');
    expect(d.settings.warmup.daily_follows).toBe(20);
    expect(d.settings.posting?.posts_per_day).toBe(1);
    expect(calls[0].url).toBe('/api/customer/accounts/a1');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('history paginates with limit + cursor in reverse chronological order', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          tasks: [
            { id: 't3', kind: 'warmup', status: 'success', started_at: '2026-04-19T10:00:00Z' },
            { id: 't2', kind: 'warmup', status: 'failure', started_at: '2026-04-18T10:00:00Z' },
          ],
          next_cursor: 'cur-1',
        },
      },
      {
        body: {
          tasks: [
            { id: 't1', kind: 'post_reel', status: 'success', started_at: '2026-04-17T10:00:00Z' },
          ],
          next_cursor: null,
        },
      },
    ]);
    const client = createAccountsClient({ fetch });
    const page1 = await client.history('a1', { limit: 2 });
    expect(page1.tasks.map((t) => t.id)).toEqual(['t3', 't2']);
    expect(page1.next_cursor).toBe('cur-1');
    expect(calls[0].url).toBe('/api/customer/accounts/a1/history?limit=2');

    const page2 = await client.history('a1', { limit: 2, cursor: page1.next_cursor });
    expect(page2.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(page2.next_cursor).toBeNull();
    expect(calls[1].url).toBe('/api/customer/accounts/a1/history?limit=2&cursor=cur-1');
  });

  it('updateSettings POSTs JSON to /settings with preset', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: {
          id: 'a1',
          username: 'acme',
          status: 'ready',
          settings: {
            warmup: { preset: 'aggressive', daily_follows: 40 },
            posting: {},
          },
        },
      },
    ]);
    const client = createAccountsClient({ fetch });
    await client.updateSettings('a1', {
      warmup: { preset: 'aggressive', daily_follows: 40 },
      posting: {},
    });
    expect(calls[0].url).toBe('/api/customer/accounts/a1/settings');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.warmup.preset).toBe('aggressive');
    expect(sent.warmup.daily_follows).toBe(40);
  });

  it('startWarmup hits /start-warmup', async () => {
    const { fetch, calls } = mockFetch([
      { body: { id: 'a1', status: 'warming' } },
    ]);
    const client = createAccountsClient({ fetch });
    const r = await client.startWarmup('a1');
    expect(r.status).toBe('warming');
    expect(calls[0].url).toBe('/api/customer/accounts/a1/start-warmup');
    expect(calls[0].init.method).toBe('POST');
  });

  it('remove DELETEs the account and tolerates empty 204', async () => {
    const { fetch, calls } = mockFetch([
      { status: 204, statusText: 'No Content', body: undefined },
    ]);
    const client = createAccountsClient({ fetch });
    await expect(client.remove('a1')).resolves.toBeUndefined();
    expect(calls[0].url).toBe('/api/customer/accounts/a1');
    expect(calls[0].init.method).toBe('DELETE');
  });
});
