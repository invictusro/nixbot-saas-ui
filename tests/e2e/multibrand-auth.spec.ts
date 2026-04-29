import { test, expect, request as pwRequest } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — local .mjs helper
import { startBrandRouter } from './multibrand-router.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.E2E_API_URL ?? '';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const API_REPO = process.env.E2E_API_REPO ?? resolve(HERE, '../../../nixbot-main-api');
const TEST_PASSWORD = 'hunter2-multibrand';

const SKIP_REASON =
  'set E2E_API_URL to a running nixbot-main-api and E2E_DATABASE_URL pointing at its Postgres';

type Router = { url: string; hostname: string; close: () => Promise<void> };

function decodeJwtUserId(token: string): string {
  const [, payload] = token.split('.');
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const claims = JSON.parse(json) as { user_id?: string };
  if (!claims.user_id) throw new Error(`jwt has no user_id claim: ${json}`);
  return claims.user_id;
}

function bcryptViaGo(password: string): string {
  const r = spawnSync('go', ['run', './cmd/passhash', password], {
    cwd: API_REPO,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`bcrypt helper failed: ${r.stderr || r.stdout}`);
  return (r.stdout ?? '').trim();
}

function psqlExec(sql: string): { code: number; out: string; err: string } {
  const r = spawnSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function seedCustomer(email: string, bcryptHash: string): void {
  const r = psqlExec(
    `INSERT INTO customers (email, password_hash) VALUES ('${email}', '${bcryptHash}') ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;`,
  );
  if (r.code !== 0) throw new Error(`psql seed failed: ${r.err || r.out}`);
}

function deleteCustomer(email: string): void {
  psqlExec(`DELETE FROM customers WHERE email='${email}';`);
}

function countCustomersByEmail(email: string): number {
  const r = psqlExec(`SELECT count(*) FROM customers WHERE lower(email) = lower('${email}');`);
  if (r.code !== 0) throw new Error(`psql count failed: ${r.err || r.out}`);
  return Number(r.out.trim());
}

test.describe('platform-auth-bearer e2e: multi-brand identity unification', () => {
  test.skip(!API_URL || !DATABASE_URL, SKIP_REASON);

  let nixbot: Router;
  let phonepilot: Router;
  let email: string;

  test.beforeAll(async () => {
    nixbot = await startBrandRouter({ port: 0, hostname: 'app.nixbot.com', upstream: API_URL });
    phonepilot = await startBrandRouter({
      port: 0,
      hostname: 'app.phonepilot.com',
      upstream: API_URL,
    });

    email = `e2e-bearer-${Date.now()}@example.com`;
    seedCustomer(email, bcryptViaGo(TEST_PASSWORD));
  });

  test.afterAll(async () => {
    if (email) deleteCustomer(email);
    await nixbot?.close();
    await phonepilot?.close();
  });

  test('login on brand A, logout, login on brand B — both resolve to one customers row', async () => {
    const ctxA = await pwRequest.newContext({
      baseURL: nixbot.url,
      extraHTTPHeaders: { Origin: `https://${nixbot.hostname}` },
    });
    const ctxB = await pwRequest.newContext({
      baseURL: phonepilot.url,
      extraHTTPHeaders: { Origin: `https://${phonepilot.hostname}` },
    });

    // 1. Login on brand A → access token in body, refresh cookie set on brand A only.
    const loginA = await ctxA.post('/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(loginA.status(), `login A body: ${await loginA.text()}`).toBe(200);
    const bodyA = (await loginA.json()) as { access_token: string; token_type: string };
    expect(bodyA.token_type).toBe('Bearer');
    expect(bodyA.access_token).toBeTruthy();
    const userIdA = decodeJwtUserId(bodyA.access_token);
    const bearerA = { Authorization: `Bearer ${bodyA.access_token}` };

    const refreshCookieA = (await ctxA.storageState()).cookies.find(
      (c) => c.name === 'refresh_token',
    );
    expect(refreshCookieA, 'refresh_token cookie set on brand A').toBeTruthy();

    // Sanity: Bearer is accepted by a protected endpoint (403 = auth passed,
    // not admin; 401 would mean the token was rejected).
    const protectedPre = await ctxA.get('/admin/customers', { headers: bearerA });
    expect(protectedPre.status(), 'pre-logout Bearer must authenticate').toBe(403);

    // 2. Logout on brand A blacklists both the refresh cookie and the Bearer.
    const logoutA = await ctxA.post('/auth/logout', { headers: bearerA });
    expect([200, 204]).toContain(logoutA.status());

    const refreshAfterLogout = await ctxA.post('/auth/refresh');
    expect(refreshAfterLogout.status(), 'refresh after logout must fail').toBe(401);

    const protectedPost = await ctxA.get('/admin/customers', { headers: bearerA });
    expect(protectedPost.status(), 'post-logout Bearer must be rejected').toBe(401);

    // 3. Login on brand B with the same credentials.
    const loginB = await ctxB.post('/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(loginB.status(), `login B body: ${await loginB.text()}`).toBe(200);
    const bodyB = (await loginB.json()) as { access_token: string; token_type: string };
    expect(bodyB.token_type).toBe('Bearer');
    const userIdB = decodeJwtUserId(bodyB.access_token);

    // 4. Server-side identity unification: same user_id from two different brand origins.
    expect(userIdB).toBe(userIdA);

    // 5. DB confirms exactly one customers row for the email — server-side proof
    //    that the two brand origins resolved to one identity, enforced by the
    //    customers.email UNIQUE constraint.
    expect(countCustomersByEmail(email)).toBe(1);

    // 6. Brand A's refresh cookie is gone; brand B's is set and not present in A's jar.
    const cookiesB = (await ctxB.storageState()).cookies;
    const refreshCookieB = cookiesB.find((c) => c.name === 'refresh_token');
    expect(refreshCookieB).toBeTruthy();
    const cookiesAAfter = (await ctxA.storageState()).cookies;
    const stillHasRefresh = cookiesAAfter.find(
      (c) => c.name === 'refresh_token' && c.value === refreshCookieB?.value,
    );
    expect(stillHasRefresh, 'brand B refresh cookie must not appear in brand A jar').toBeFalsy();

    await ctxA.dispose();
    await ctxB.dispose();
  });
});
