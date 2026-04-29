import { writable, type Writable } from './stores';

export interface User {
  id: string;
  email?: string;
  is_admin?: boolean;
  impersonated_by?: string | null;
}

export interface AuthClient {
  login(email: string, password: string): Promise<User>;
  register(email: string, password: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<User>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  setupPassword(token: string, newPassword: string): Promise<User>;
  refresh(): Promise<User>;
  me(): Promise<User | null>;
  logout(): Promise<void>;
  stopImpersonation(): Promise<User>;
}

export interface AuthFetchOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ApiFetchInit extends RequestInit {
  skipAuth?: boolean;
  skipRefresh?: boolean;
}

export type ApiFetch = (path: string, init?: ApiFetchInit) => Promise<Response>;

export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const accessToken: Writable<string | null> = writable(null);

let onSessionExpired: () => void = () => {
  if (typeof window !== 'undefined') {
    window.location.assign('/login');
  }
};

export function setSessionExpiredHandler(fn: () => void): void {
  onSessionExpired = fn;
}

function defaultFetch(): typeof fetch {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) throw new Error('fetch is not available');
  return f.bind(globalThis);
}

function decodeJwtPayload(
  token: string,
): { user_id?: string; is_admin?: boolean; impersonated_by?: string } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad === 2) b64 += '==';
    else if (pad === 3) b64 += '=';
    else if (pad !== 0) return null;
    const decoded =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('binary');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function userFromToken(token: string, email?: string): User {
  const c = decodeJwtPayload(token) ?? {};
  return {
    id: c.user_id ?? '',
    ...(email !== undefined ? { email } : {}),
    is_admin: !!c.is_admin,
    impersonated_by: c.impersonated_by ?? null,
  };
}

const REFRESH_PATH = '/api/auth/refresh';

export function createApiFetch(opts: AuthFetchOptions = {}): ApiFetch {
  const baseUrl = opts.baseUrl ?? '';
  const fetcher = opts.fetch ?? defaultFetch();
  let inflight: Promise<string | null> | null = null;

  function raw(path: string, init: ApiFetchInit): Promise<Response> {
    const headers = new Headers(init.headers);
    const tok = accessToken.get();
    if (!init.skipAuth && tok) {
      headers.set('Authorization', `Bearer ${tok}`);
    }
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const out: RequestInit & { skipAuth?: boolean; skipRefresh?: boolean } = {
      ...init,
      headers,
      credentials: 'include',
    };
    delete out.skipAuth;
    delete out.skipRefresh;
    return fetcher(`${baseUrl}${path}`, out);
  }

  async function refresh(): Promise<string | null> {
    if (inflight) return inflight;
    const p = (async (): Promise<string | null> => {
      try {
        const res = await raw(REFRESH_PATH, {
          method: 'POST',
          skipAuth: true,
          skipRefresh: true,
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { access_token?: string };
        if (!data.access_token) return null;
        accessToken.set(data.access_token);
        return data.access_token;
      } catch {
        return null;
      }
    })();
    inflight = p;
    try {
      return await p;
    } finally {
      inflight = null;
    }
  }

  return async function apiFetch(path, init = {}): Promise<Response> {
    const res = await raw(path, init);
    if (res.status !== 401 || init.skipRefresh) return res;
    const next = await refresh();
    if (!next) {
      accessToken.set(null);
      onSessionExpired();
      return res;
    }
    return raw(path, { ...init, skipRefresh: true });
  };
}

async function readError(res: Response): Promise<AuthError> {
  let msg = res.statusText;
  let code: string | undefined;
  try {
    const data = (await res.clone().json()) as { error?: string; code?: string };
    if (data.error) msg = data.error;
    if (data.code) code = data.code;
  } catch {
    // non-json body; keep statusText
  }
  return new AuthError(res.status, msg, code);
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function createAuthClient(opts: AuthFetchOptions = {}): AuthClient {
  const api = createApiFetch(opts);

  async function postJson(path: string, body?: unknown, skipRefresh = false): Promise<Response> {
    const init: ApiFetchInit = { method: 'POST', skipRefresh };
    if (body !== undefined) init.body = JSON.stringify(body);
    return api(path, init);
  }

  async function ensureOk(res: Response): Promise<void> {
    if (!res.ok) throw await readError(res);
  }

  return {
    async login(email, password) {
      const res = await postJson('/api/auth/login', { email, password }, true);
      await ensureOk(res);
      const data = await parseJson<{ access_token: string }>(res);
      accessToken.set(data.access_token);
      return userFromToken(data.access_token, email);
    },
    async register(email, password) {
      const res = await postJson('/api/auth/register', { email, password }, true);
      await ensureOk(res);
    },
    async verifyEmail(email, code) {
      const res = await postJson('/api/auth/verify-email', { email, code }, true);
      await ensureOk(res);
      return parseJson<User>(res);
    },
    async requestPasswordReset(email) {
      const res = await postJson('/api/auth/reset-request', { email }, true);
      await ensureOk(res);
    },
    async confirmPasswordReset(email, code, newPassword) {
      const res = await postJson(
        '/api/auth/reset-confirm',
        { email, code, new_password: newPassword },
        true,
      );
      await ensureOk(res);
    },
    async setupPassword(token, newPassword) {
      const res = await postJson(
        '/api/auth/setup-password',
        { token, new_password: newPassword },
        true,
      );
      await ensureOk(res);
      const data = await parseJson<{ access_token: string; email?: string }>(res);
      accessToken.set(data.access_token);
      return userFromToken(data.access_token, data.email);
    },
    async refresh() {
      const res = await api(REFRESH_PATH, {
        method: 'POST',
        skipAuth: true,
        skipRefresh: true,
      });
      await ensureOk(res);
      const data = await parseJson<{ access_token: string }>(res);
      accessToken.set(data.access_token);
      return userFromToken(data.access_token);
    },
    async me() {
      const tok = accessToken.get();
      if (tok) return userFromToken(tok);
      try {
        return await this.refresh();
      } catch (err) {
        if (err instanceof AuthError && err.status === 401) return null;
        throw err;
      }
    },
    async logout() {
      const res = await api('/api/auth/logout', { method: 'POST', skipRefresh: true });
      accessToken.set(null);
      if (!res.ok && res.status !== 401) throw await readError(res);
    },
    async stopImpersonation() {
      const res = await api('/api/auth/stop-impersonation', { method: 'POST' });
      await ensureOk(res);
      const data = await parseJson<{ access_token: string }>(res);
      accessToken.set(data.access_token);
      return userFromToken(data.access_token);
    },
  };
}

export const auth = createAuthClient();
