import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAuthClient,
  createApiFetch,
  AuthError,
  accessToken,
  setSessionExpiredHandler,
} from './auth';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) =>
    Buffer.from(s).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify(payload))}.sig`;
}

interface MockResponse {
  status?: number;
  statusText?: string;
  body?: unknown;
}

function mockFetch(responses: Array<MockResponse>): {
  fetch: typeof fetch;
  calls: Call[];
} {
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

beforeEach(() => {
  accessToken.set(null);
  setSessionExpiredHandler(() => {});
});

describe('auth client', () => {
  it('login posts credentials, stores access token, derives user from JWT + form email', async () => {
    const token = fakeJwt({ user_id: 'u1' });
    const { fetch, calls } = mockFetch([
      { body: { access_token: token, expires_in: 900, token_type: 'Bearer' } },
    ]);
    const client = createAuthClient({ fetch, baseUrl: 'http://x' });
    const user = await client.login('a@b.com', 'pw');
    expect(user).toMatchObject({ id: 'u1', email: 'a@b.com', is_admin: false });
    expect(accessToken.get()).toBe(token);
    expect(calls[0].url).toBe('http://x/api/auth/login');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.body).toBe(JSON.stringify({ email: 'a@b.com', password: 'pw' }));
  });

  it('login surfaces typed AuthError on 401 without attempting a refresh', async () => {
    const { fetch, calls } = mockFetch([
      { status: 401, statusText: 'Unauthorized', body: { error: 'bad creds', code: 'invalid_credentials' } },
    ]);
    const client = createAuthClient({ fetch });
    const err = await client.login('a@b.com', 'wrong').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(calls).toHaveLength(1);
    expect(accessToken.get()).toBeNull();
  });

  it('me returns user from in-memory token without hitting the network', async () => {
    accessToken.set(fakeJwt({ user_id: 'u1', is_admin: true }));
    const { fetch, calls } = mockFetch([]);
    const client = createAuthClient({ fetch });
    const me = await client.me();
    expect(me).toMatchObject({ id: 'u1', is_admin: true });
    expect(calls).toHaveLength(0);
  });

  it('me with no token tries refresh and recovers a user', async () => {
    const newToken = fakeJwt({ user_id: 'u9' });
    const { fetch, calls } = mockFetch([
      { body: { access_token: newToken, expires_in: 900, token_type: 'Bearer' } },
    ]);
    const client = createAuthClient({ fetch });
    const me = await client.me();
    expect(me).toMatchObject({ id: 'u9' });
    expect(accessToken.get()).toBe(newToken);
    expect(calls[0].url).toContain('/api/auth/refresh');
    expect(calls[0].init.credentials).toBe('include');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it('me with no token returns null when refresh fails with 401', async () => {
    const { fetch } = mockFetch([{ status: 401, statusText: 'Unauthorized', body: { error: 'no session' } }]);
    const client = createAuthClient({ fetch });
    const me = await client.me();
    expect(me).toBeNull();
    expect(accessToken.get()).toBeNull();
  });

  it('throws AuthError on non-401 failure with parsed error body', async () => {
    const { fetch } = mockFetch([
      { status: 400, statusText: 'Bad Request', body: { error: 'invalid', code: 'bad_email' } },
    ]);
    const client = createAuthClient({ fetch });
    const err = await client.login('x', 'y').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toMatchObject({ status: 400, message: 'invalid', code: 'bad_email' });
  });

  it('stopImpersonation posts, stores rotated token, returns admin user', async () => {
    const adminToken = fakeJwt({ user_id: 'admin1', is_admin: true });
    accessToken.set(fakeJwt({ user_id: 'cust1', impersonated_by: 'admin1' }));
    const { fetch, calls } = mockFetch([
      { body: { access_token: adminToken, expires_in: 900, token_type: 'Bearer' } },
    ]);
    const client = createAuthClient({ fetch, baseUrl: 'http://x' });
    const user = await client.stopImpersonation();
    expect(user).toMatchObject({ id: 'admin1', is_admin: true });
    expect(accessToken.get()).toBe(adminToken);
    expect(calls[0].url).toBe('http://x/api/auth/stop-impersonation');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('logout clears the access token in memory', async () => {
    accessToken.set(fakeJwt({ user_id: 'u1' }));
    const { fetch, calls } = mockFetch([{ status: 204, body: undefined }]);
    const client = createAuthClient({ fetch });
    await client.logout();
    expect(accessToken.get()).toBeNull();
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.credentials).toBe('include');
  });
});

describe('bearer + refresh-on-401', () => {
  it('attaches Authorization: Bearer on every authed call', async () => {
    const token = fakeJwt({ user_id: 'u1' });
    accessToken.set(token);
    const { fetch, calls } = mockFetch([{ body: {} }]);
    const api = createApiFetch({ fetch });
    await api('/api/customer/summary', { method: 'GET' });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(calls[0].init.credentials).toBe('include');
  });

  it('401 triggers refresh, retries the original request once with the new token', async () => {
    const stale = fakeJwt({ user_id: 'u1' });
    const fresh = fakeJwt({ user_id: 'u1' });
    accessToken.set(stale);
    const { fetch, calls } = mockFetch([
      { status: 401, statusText: 'Unauthorized', body: { error: 'expired' } },
      { body: { access_token: fresh, expires_in: 900, token_type: 'Bearer' } },
      { body: { ok: true } },
    ]);
    const api = createApiFetch({ fetch });
    const res = await api('/api/customer/summary', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('/api/customer/summary');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(`Bearer ${stale}`);
    expect(calls[1].url).toBe('/api/auth/refresh');
    expect(new Headers(calls[1].init.headers).get('authorization')).toBeNull();
    expect(calls[2].url).toBe('/api/customer/summary');
    expect(new Headers(calls[2].init.headers).get('authorization')).toBe(`Bearer ${fresh}`);
    expect(accessToken.get()).toBe(fresh);
  });

  it('failed refresh clears token, invokes session-expired handler, returns the original 401', async () => {
    accessToken.set(fakeJwt({ user_id: 'u1' }));
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    const { fetch, calls } = mockFetch([
      { status: 401, statusText: 'Unauthorized', body: { error: 'stale' } },
      { status: 401, statusText: 'Unauthorized', body: { error: 'no cookie' } },
    ]);
    const api = createApiFetch({ fetch });
    const res = await api('/api/customer/summary', { method: 'GET' });
    expect(res.status).toBe(401);
    expect(accessToken.get()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe('/api/auth/refresh');
  });

  it('does not loop refreshing when /auth/refresh itself returns 401', async () => {
    const { fetch, calls } = mockFetch([
      { status: 401, statusText: 'Unauthorized', body: { error: 'no cookie' } },
    ]);
    const client = createAuthClient({ fetch });
    const err = await client.refresh().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/refresh');
  });

  it('coalesces concurrent refreshes into a single /auth/refresh call', async () => {
    const stale = fakeJwt({ user_id: 'u1' });
    const fresh = fakeJwt({ user_id: 'u1' });
    accessToken.set(stale);
    const { fetch, calls } = mockFetch([
      { status: 401, statusText: 'Unauthorized', body: { error: 'expired' } },
      { status: 401, statusText: 'Unauthorized', body: { error: 'expired' } },
      { body: { access_token: fresh, expires_in: 900, token_type: 'Bearer' } },
      { body: { ok: 1 } },
      { body: { ok: 2 } },
    ]);
    const api = createApiFetch({ fetch });
    const [r1, r2] = await Promise.all([
      api('/api/customer/summary', { method: 'GET' }),
      api('/api/customer/accounts', { method: 'GET' }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const refreshCalls = calls.filter((c) => c.url === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(accessToken.get()).toBe(fresh);
  });
});
