import { describe, it, expect, vi } from 'vitest';
import { createAuthClient, AuthError } from './auth';

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: Array<Partial<Response> & { body?: unknown }>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no mock response queued');
    const bodyStr = JSON.stringify(next.body ?? {});
    return new Response(bodyStr, {
      status: next.status ?? 200,
      statusText: next.statusText ?? 'OK',
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe('auth client', () => {
  it('login posts credentials and returns user', async () => {
    const { fetch, calls } = mockFetch([{ body: { id: 'u1', email: 'a@b.com' } }]);
    const client = createAuthClient({ fetch, baseUrl: 'http://x' });
    const user = await client.login('a@b.com', 'pw');
    expect(user).toEqual({ id: 'u1', email: 'a@b.com' });
    expect(calls[0].url).toBe('http://x/api/auth/login');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.body).toBe(JSON.stringify({ email: 'a@b.com', password: 'pw' }));
  });

  it('me returns null on 401 without throwing', async () => {
    const { fetch } = mockFetch([{ status: 401, statusText: 'Unauthorized', body: { error: 'no session' } }]);
    const client = createAuthClient({ fetch });
    const me = await client.me();
    expect(me).toBeNull();
  });

  it('throws AuthError on non-401 failure with parsed error body', async () => {
    const { fetch } = mockFetch([{ status: 400, statusText: 'Bad Request', body: { error: 'invalid', code: 'bad_email' } }]);
    const client = createAuthClient({ fetch });
    const err = await client.login('x', 'y').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toMatchObject({ status: 400, message: 'invalid', code: 'bad_email' });
  });

  it('stopImpersonation posts and returns admin user', async () => {
    const { fetch, calls } = mockFetch([
      { body: { id: 'admin1', email: 'admin@x.com', is_admin: true } },
    ]);
    const client = createAuthClient({ fetch, baseUrl: 'http://x' });
    const user = await client.stopImpersonation();
    expect(user).toEqual({ id: 'admin1', email: 'admin@x.com', is_admin: true });
    expect(calls[0].url).toBe('http://x/api/auth/stop-impersonation');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('logout has no body and uses POST', async () => {
    const { fetch, calls } = mockFetch([{ body: {} }]);
    const client = createAuthClient({ fetch });
    await client.logout();
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.credentials).toBe('include');
  });
});
