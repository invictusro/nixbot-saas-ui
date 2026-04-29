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
const OTHER_SUB_ID = '99999999-9999-9999-9999-999999999999';
const ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const DETAIL_FIXTURE = {
  id: SUB_ID,
  created_at: '2026-04-15T10:00:00Z',
  sku_code: 'managed_3acc_1mo',
  sku_name: 'Managed Posting',
  state: 'active',
  started_at: '2026-04-15T10:30:00Z',
  next_renewal_at: '2026-05-15T10:30:00Z',
  last_renewed_at: null,
  monthly_price_cents: 19900,
  source_brand: 'phonepilot',
  account_count: 3,
  posts_per_week: 5,
  cancel_at_cycle: null,
  assignments: [
    {
      id: 'asgn-1',
      account_id: ACCOUNT_ID,
      username: 'ig.handle.one',
      status: 'active',
      warmup_days: 21,
      started_at: '2026-04-15T11:00:00Z',
      next_post_at: '2026-04-27T16:00:00Z',
      pending_creation: false,
    },
    {
      id: 'asgn-2',
      account_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      username: 'ig.handle.two',
      status: 'warming',
      warmup_days: 4,
      started_at: '2026-04-16T11:00:00Z',
      next_post_at: null,
      pending_creation: false,
    },
    {
      id: 'asgn-3',
      account_id: '',
      username: '',
      status: '',
      warmup_days: 0,
      started_at: '2026-04-17T11:00:00Z',
      next_post_at: null,
      pending_creation: true,
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
      body: JSON.stringify({ subscriptions: [DETAIL_FIXTURE] }),
    }),
  );
}

test.describe('customer-ui-subscriptions: /subscriptions/:id detail', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('renders subscription metadata + active managed assignments', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('customer-subscription-detail')).toBeVisible();
    await expect(page.getByTestId('customer-subscription-detail-state')).toHaveText('active');
    const monthly = page.getByTestId('customer-subscription-detail-monthly');
    expect(await monthly.getAttribute('data-cents')).toBe('19900');
    await expect(monthly).toHaveText('$199.00');
    await expect(page.getByTestId('customer-subscription-detail-account-count')).toHaveText('3');
    await expect(page.getByTestId('customer-subscription-detail-posts-per-week')).toHaveText('5');

    await expect(page.getByTestId('customer-subscription-assignment')).toHaveCount(3);
    const handles = await page
      .getByTestId('customer-subscription-assignment-handle')
      .allTextContents();
    expect(handles[0]).toBe('@ig.handle.one');
    expect(handles[1]).toBe('@ig.handle.two');
    expect(handles[2]).toMatch(/being created/i);
  });

  test('status badges render the warming / active / banned variants', async ({ page }) => {
    const fixture = {
      ...DETAIL_FIXTURE,
      assignments: [
        { ...DETAIL_FIXTURE.assignments[0], status: 'active' },
        { ...DETAIL_FIXTURE.assignments[1], status: 'warming' },
        {
          ...DETAIL_FIXTURE.assignments[1],
          id: 'asgn-banned',
          account_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          username: 'ig.handle.three',
          status: 'banned',
        },
      ],
    };
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);

    const active = page.locator('[data-testid="customer-subscription-assignment"][data-status="active"]');
    const warming = page.locator('[data-testid="customer-subscription-assignment"][data-status="warming"]');
    const banned = page.locator('[data-testid="customer-subscription-assignment"][data-status="banned"]');
    await expect(active).toHaveCount(1);
    await expect(warming).toHaveCount(1);
    await expect(banned).toHaveCount(1);

    const activeCls = (await active.getByTestId('customer-subscription-assignment-status').getAttribute('class')) ?? '';
    const warmingCls = (await warming.getByTestId('customer-subscription-assignment-status').getAttribute('class')) ?? '';
    const bannedCls = (await banned.getByTestId('customer-subscription-assignment-status').getAttribute('class')) ?? '';
    expect(activeCls).toMatch(/emerald|green/);
    expect(warmingCls).toMatch(/amber|yellow/);
    expect(bannedCls).toMatch(/rose|red/);
  });

  test('clicking an account navigates to /subscriptions/:id/accounts/:accountId', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    const link = page.getByTestId('customer-subscription-assignment-link').first();
    const href = await link.getAttribute('href');
    expect(href).toBe(`/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
    await link.click();
    await expect(page).toHaveURL(`${UI_BASE}/subscriptions/${SUB_ID}/accounts/${ACCOUNT_ID}`);
  });

  test('placeholder (pending_creation) row is not clickable', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    const placeholder = page.locator(
      '[data-testid="customer-subscription-assignment"][data-pending-creation="true"]',
    );
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder.getByTestId('customer-subscription-assignment-link')).toHaveCount(0);
  });

  test('view is read-only — no edit/save controls anywhere on the page', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    const detail = page.getByTestId('customer-subscription-detail');
    await expect(detail.locator('input')).toHaveCount(0);
    await expect(detail.locator('textarea')).toHaveCount(0);
    await expect(detail.locator('select')).toHaveCount(0);
    await expect(detail.locator('button')).toHaveCount(0);
    await expect(
      detail.locator(
        ':text("read-only"), :text("Read-only"), :text("Read only"), :text("read only")',
      ),
    ).toHaveCount(1);
  });

  test('other customer subscription returns 404 → friendly not-found message', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${OTHER_SUB_ID}`, async (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'subscription not found' }),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${OTHER_SUB_ID}`);
    await expect(page.getByTestId('customer-subscription-detail-error')).toContainText(
      /not found/i,
    );
    await expect(page.getByTestId('customer-subscription-assignment')).toHaveCount(0);
  });

  test('empty assignments renders the empty-state copy', async ({ page }) => {
    const empty = { ...DETAIL_FIXTURE, assignments: [], state: 'pending_activation' };
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(empty),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('customer-subscription-assignments-empty')).toBeVisible();
    await expect(page.getByTestId('customer-subscription-assignment')).toHaveCount(0);
  });
});
