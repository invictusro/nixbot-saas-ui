export interface User {
  id: string;
  email: string;
  is_admin?: boolean;
  impersonated_by?: string | null;
}

export interface AuthClient {
  login(email: string, password: string): Promise<User>;
  register(email: string, password: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<User>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  refresh(): Promise<User>;
  me(): Promise<User | null>;
  logout(): Promise<void>;
  stopImpersonation(): Promise<User>;
}

export interface AuthFetchOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

type JsonBody = Record<string, unknown>;

const JSON_HEADERS: HeadersInit = { 'content-type': 'application/json' };

export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createAuthClient(opts: AuthFetchOptions = {}): AuthClient {
  const baseUrl = opts.baseUrl ?? '';
  const f = opts.fetch ?? fetch.bind(globalThis);

  async function call(path: string, method: string, body?: JsonBody): Promise<Response> {
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
        // non-json body; keep statusText
      }
      throw new AuthError(res.status, msg, code);
    }
    return res;
  }

  async function parse<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  return {
    async login(email, password) {
      const res = await call('/api/auth/login', 'POST', { email, password });
      return parse<User>(res);
    },
    async register(email, password) {
      await call('/api/auth/register', 'POST', { email, password });
    },
    async verifyEmail(email, code) {
      const res = await call('/api/auth/verify-email', 'POST', { email, code });
      return parse<User>(res);
    },
    async requestPasswordReset(email) {
      await call('/api/auth/reset-request', 'POST', { email });
    },
    async confirmPasswordReset(email, code, newPassword) {
      await call('/api/auth/reset-confirm', 'POST', { email, code, new_password: newPassword });
    },
    async refresh() {
      const res = await call('/api/auth/refresh', 'POST');
      return parse<User>(res);
    },
    async me() {
      try {
        const res = await call('/api/auth/me', 'GET');
        return parse<User>(res);
      } catch (err) {
        if (err instanceof AuthError && err.status === 401) return null;
        throw err;
      }
    },
    async logout() {
      await call('/api/auth/logout', 'POST');
    },
    async stopImpersonation() {
      const res = await call('/api/auth/stop-impersonation', 'POST');
      return parse<User>(res);
    },
  };
}

export const auth = createAuthClient();
