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

const CUSTOMER_TOKEN = fakeJwt({
  user_id: 'cust_self',
  is_admin: false,
  exp: Math.floor(Date.now() / 1000) + 900,
});

const SUB_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STRANGER_ACCOUNT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const DRILL_FIXTURE = {
  assignment_id: 'asgn-1',
  subscription_id: SUB_ID,
  sku_code: 'managed_3acc_1mo',
  sku_name: 'Managed Posting',
  source_brand: 'phonepilot',
  account_id: ACCOUNT_ID,
  username: 'ig.handle.one',
  status: 'active',
  warmup_days: 21,
  started_at: '2026-04-15T11:00:00Z',
  next_post_at: '2026-04-27T16:00:00Z',
  posts_total: 3,
  posts_posted: 2,
  posts_failed: 1,
  deliveries: [
    {
      id: 'd-1',
      posted_at: '2026-04-16T12:00:00Z',
      state: 'posted',
      ig_post_url: 'https://instagram.com/p/abc',
    },
    {
      id: 'd-2',
      posted_at: '2026-04-17T12:00:00Z',
      state: 'posted',
      ig_post_url: null,
    },
    {
      id: 'd-3',
      posted_at: '2026-04-18T12:00:00Z',
      state: 'failed',
      ig_post_url: null,
    },
  ],
};

async function mockAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/refresh', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: CUSTOMER_TOKEN, token_type: 'Bearer' }),
    }),
  );
  await page.route('**/api/customer/orders*', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }),
  );
  await page.route('**/api/customer/subscriptions', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subscriptions: [] }),
    }),
  );
}

test.describe('customer-ui-subscriptions: /subscriptions/:id/accounts/:accountId drill', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('renders the read-only AccountDetail layout with stats and post activity', async ({
    page,
  }) => {
    await page.route(
      `**/api/customer/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`,
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(DRILL_FIXTURE),
        }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
    await expect(page.getByTestId('customer-subscription-account-detail')).toBeVisible();
    await expect(page.getByTestId('customer-subscription-account-handle')).toHaveText(
      '@ig.handle.one',
    );
    await expect(page.getByTestId('customer-subscription-account-warmup-days')).toHaveText('21');
    await expect(page.getByTestId('customer-subscription-account-posts-total')).toHaveText('3');
    await expect(page.getByTestId('customer-subscription-account-posts-posted')).toHaveText('2');
    const status = page.getByTestId('customer-subscription-account-status');
    expect(await status.getAttribute('data-status')).toBe('active');
    const statusCls = (await status.getAttribute('class')) ?? '';
    expect(statusCls).toMatch(/emerald|green/);
    const next = page.getByTestId('customer-subscription-account-next-post');
    expect(await next.textContent()).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test('post deliveries list is scoped to this (subscription, account) and renders IG link when present', async ({
    page,
  }) => {
    await page.route(
      `**/api/customer/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`,
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(DRILL_FIXTURE),
        }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
    await expect(page.getByTestId('customer-subscription-account-delivery')).toHaveCount(3);
    const links = page.getByTestId('customer-subscription-account-delivery-link');
    await expect(links).toHaveCount(1);
    expect(await links.first().getAttribute('href')).toBe('https://instagram.com/p/abc');
    const failed = page.locator(
      '[data-testid="customer-subscription-account-delivery"][data-state="failed"]',
    );
    await expect(failed).toHaveCount(1);
    const failedCls =
      (await failed
        .getByTestId('customer-subscription-account-delivery-state')
        .getAttribute('class')) ?? '';
    expect(failedCls).toMatch(/rose|red/);
  });

  test('view is read-only — no edit/save controls anywhere on the page', async ({ page }) => {
    await page.route(
      `**/api/customer/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`,
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(DRILL_FIXTURE),
        }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
    const detail = page.getByTestId('customer-subscription-account-detail');
    await expect(detail.locator('input')).toHaveCount(0);
    await expect(detail.locator('textarea')).toHaveCount(0);
    await expect(detail.locator('select')).toHaveCount(0);
    await expect(detail.locator('button')).toHaveCount(0);
    await expect(
      detail.locator(
        ':text("read-only"), :text("Read-only"), :text("Read only"), :text("read only")',
      ),
    ).not.toHaveCount(0);
  });

  test('non-owning customer (403) renders a friendly forbidden message', async ({ page }) => {
    await page.route(
      `**/api/customer/subscriptions/${SUB_ID}/accounts/${STRANGER_ACCOUNT_ID}`,
      async (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'forbidden' }),
        }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${STRANGER_ACCOUNT_ID}`);
    const err = page.getByTestId('customer-subscription-account-error');
    await expect(err).toBeVisible();
    expect(await err.getAttribute('data-status')).toBe('403');
    await expect(err).toContainText(/isn't part|not part/i);
    await expect(page.getByTestId('customer-subscription-account-delivery')).toHaveCount(0);
  });

  test('subscription owned by another customer (404) renders a not-found message', async ({
    page,
  }) => {
    await page.route(
      `**/api/customer/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`,
      async (route) =>
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'subscription not found' }),
        }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
    const err = page.getByTestId('customer-subscription-account-error');
    await expect(err).toContainText(/not found/i);
  });

  test('empty deliveries renders empty-state copy', async ({ page }) => {
    const empty = {
      ...DRILL_FIXTURE,
      posts_total: 0,
      posts_posted: 0,
      posts_failed: 0,
      deliveries: [],
    };
    await page.route(
      `**/api/customer/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`,
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(empty),
        }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
    await expect(page.getByTestId('customer-subscription-account-deliveries-empty')).toBeVisible();
    await expect(page.getByTestId('customer-subscription-account-delivery')).toHaveCount(0);
  });
});
