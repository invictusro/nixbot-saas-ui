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

describe('auth flows', () => {
  it('register → verifyEmail returns user and uses cookie credentials', async () => {
    const { fetch, calls } = mockFetch([
      { body: {} },
      { body: { id: 'u1', email: 'a@b.com' } },
    ]);
    const client = createAuthClient({ fetch, baseUrl: 'http://x' });
    await client.register('a@b.com', 'pw12345678');
    const user = await client.verifyEmail('a@b.com', '123456');
    expect(user).toEqual({ id: 'u1', email: 'a@b.com' });
    expect(calls[0].url).toBe('http://x/api/auth/register');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[1].url).toBe('http://x/api/auth/verify-email');
    expect(calls[1].init.body).toBe(JSON.stringify({ email: 'a@b.com', code: '123456' }));
  });

  it('verifyEmail surfaces typed AuthError on bad code', async () => {
    const { fetch } = mockFetch([
      { status: 400, statusText: 'Bad Request', body: { error: 'wrong code', code: 'invalid_code' } },
    ]);
    const client = createAuthClient({ fetch });
    const err = await client.verifyEmail('a@b.com', '000000').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toMatchObject({ status: 400, message: 'wrong code', code: 'invalid_code' });
  });

  it('password reset request → confirm sends snake_case new_password', async () => {
    const { fetch, calls } = mockFetch([{ body: {} }, { body: {} }]);
    const client = createAuthClient({ fetch, baseUrl: 'http://x' });
    await client.requestPasswordReset('a@b.com');
    await client.confirmPasswordReset('a@b.com', '654321', 'newpw1234');
    expect(calls[0].url).toBe('http://x/api/auth/reset-request');
    expect(calls[0].init.body).toBe(JSON.stringify({ email: 'a@b.com' }));
    expect(calls[1].url).toBe('http://x/api/auth/reset-confirm');
    expect(calls[1].init.body).toBe(
      JSON.stringify({ email: 'a@b.com', code: '654321', new_password: 'newpw1234' })
    );
    expect(calls[1].init.credentials).toBe('include');
  });
});
