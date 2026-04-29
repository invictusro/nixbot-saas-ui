import { test, expect } from '@playwright/test';

const UI_PORT = Number(process.env.E2E_UI_PORT ?? 4173);
const UI_BASE = process.env.E2E_UI_URL ?? `http://127.0.0.1:${UI_PORT}`;
const RUN_UI_E2E = process.env.RUN_UI_E2E === '1';

const SKIP_REASON =
  'set RUN_UI_E2E=1 to run the Svelte UI Playwright suite (requires a working router build)';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) =>
    Buffer.from(s).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify(payload))}.sig`;
}

test.describe('platform-password-setup: /setup-password page', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test('valid flow: submits token + password, lands on /dashboard', async ({ page }) => {
    let captured: { token?: string; new_password?: string } | null = null;
    const access = fakeJwt({ user_id: 'u123' });

    await page.route('**/api/auth/setup-password', async (route) => {
      const req = route.request();
      captured = JSON.parse(req.postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie':
            'refresh_token=rt_abc; HttpOnly; Path=/; SameSite=Lax',
        },
        body: JSON.stringify({
          access_token: access,
          token_type: 'Bearer',
          email: 'new@example.com',
        }),
      });
    });

    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: access, token_type: 'Bearer' }),
      }),
    );

    await page.goto(`${UI_BASE}/setup-password?token=tok_valid`);
    await page.fill('[data-testid="password"]', 'a-strong-password');
    await page.fill('[data-testid="confirm"]', 'a-strong-password');
    await page.click('[data-testid="submit"]');

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(captured).toEqual({ token: 'tok_valid', new_password: 'a-strong-password' });
  });

  test('expired token: shows error and link to request a new one', async ({ page }) => {
    await page.route('**/api/auth/setup-password', async (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'token expired', code: 'token_expired' }),
      }),
    );

    await page.goto(`${UI_BASE}/setup-password?token=tok_expired`);
    await page.fill('[data-testid="password"]', 'a-strong-password');
    await page.fill('[data-testid="confirm"]', 'a-strong-password');
    await page.click('[data-testid="submit"]');

    await expect(page.getByTestId('setup-error')).toContainText('token expired');
    await expect(page.getByRole('link', { name: 'Request a new one' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await expect(page).toHaveURL(/\/setup-password/);
  });

  test('weak password: client-side validation blocks submit on < 8 chars', async ({ page }) => {
    let serverHit = false;
    await page.route('**/api/auth/setup-password', async (route) => {
      serverHit = true;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(`${UI_BASE}/setup-password?token=tok_weak`);
    await page.fill('[data-testid="password"]', 'short');
    await page.fill('[data-testid="confirm"]', 'short');
    await expect(page.getByTestId('weak-password')).toBeVisible();
    await expect(page.locator('[data-testid="submit"]')).toBeDisabled();
    expect(serverHit).toBe(false);
  });

  test('mismatch: client-side validation blocks submit when passwords differ', async ({ page }) => {
    let serverHit = false;
    await page.route('**/api/auth/setup-password', async (route) => {
      serverHit = true;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(`${UI_BASE}/setup-password?token=tok_mismatch`);
    await page.fill('[data-testid="password"]', 'a-strong-password');
    await page.fill('[data-testid="confirm"]', 'a-different-password');
    await expect(page.getByTestId('mismatch')).toBeVisible();
    await expect(page.locator('[data-testid="submit"]')).toBeDisabled();
    expect(serverHit).toBe(false);
  });
});
