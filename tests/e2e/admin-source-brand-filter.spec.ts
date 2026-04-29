import { test, expect, type Page } from '@playwright/test';

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

const ADMIN_TOKEN = fakeJwt({
  user_id: 'adm_1',
  is_admin: true,
  exp: Math.floor(Date.now() / 1000) + 900,
});

const CUSTOMER_FIXTURE = [
  {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    email: 'nx-1@example.com',
    plan_id: 'starter',
    plan_name: 'Starter',
    balance_cents: 1000,
    account_count: 1,
    source_brand: 'nixbot',
  },
  {
    id: 'bbbbbbbb-2222-2222-2222-222222222222',
    email: 'pp-1@example.com',
    plan_id: 'starter',
    plan_name: 'Starter',
    balance_cents: 2000,
    account_count: 0,
    source_brand: 'phonepilot',
  },
  {
    id: 'cccccccc-3333-3333-3333-333333333333',
    email: 'nx-2@example.com',
    plan_id: 'growth',
    plan_name: 'Growth',
    balance_cents: 500,
    account_count: 2,
    source_brand: 'nixbot',
  },
];

const ORDER_FIXTURE = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-04-26T10:00:00Z',
    customer_email: 'nx-1@example.com',
    source_brand: 'nixbot',
    sku_code: 'reels-10',
    state: 'pending',
    posts_done: 0,
    posts_total: 10,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    created_at: '2026-04-26T11:00:00Z',
    customer_email: 'pp-1@example.com',
    source_brand: 'phonepilot',
    sku_code: 'reels-50',
    state: 'active',
    posts_done: 12,
    posts_total: 50,
  },
];

const SUBSCRIPTION_FIXTURE = [
  {
    id: 'ssssssss-1111-1111-1111-111111111111',
    created_at: '2026-04-26T10:00:00Z',
    customer_email: 'nx-1@example.com',
    source_brand: 'nixbot',
    sku_code: 'managed-3acct',
    state: 'active',
    next_renewal_at: '2026-05-26T10:00:00Z',
    active_assignments: 3,
    required_account_count: 3,
  },
  {
    id: 'ssssssss-2222-2222-2222-222222222222',
    created_at: '2026-04-26T11:00:00Z',
    customer_email: 'pp-1@example.com',
    source_brand: 'phonepilot',
    sku_code: 'managed-1acct',
    state: 'active',
    next_renewal_at: '2026-05-26T11:00:00Z',
    active_assignments: 1,
    required_account_count: 1,
  },
];

async function mockAdminRoutes(page: Page): Promise<void> {
  await page.route('**/api/auth/refresh', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
    }),
  );
  await page.route('**/api/admin/customers*', async (route) => {
    const url = new URL(route.request().url());
    const sb = url.searchParams.get('source_brand');
    let rows = CUSTOMER_FIXTURE.slice();
    if (sb) rows = rows.filter((r) => r.source_brand === sb);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ customers: rows }),
    });
  });
  await page.route('**/api/admin/orders*', async (route) => {
    const url = new URL(route.request().url());
    const sb = url.searchParams.get('source_brand');
    let rows = ORDER_FIXTURE.slice();
    if (sb) rows = rows.filter((r) => r.source_brand === sb);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: rows }),
    });
  });
  await page.route('**/api/admin/subscriptions*', async (route) => {
    const url = new URL(route.request().url());
    const sb = url.searchParams.get('source_brand');
    let rows = SUBSCRIPTION_FIXTURE.slice();
    if (sb) rows = rows.filter((r) => r.source_brand === sb);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subscriptions: rows }),
    });
  });
}

test.describe('admin-multibrand: source_brand filter dropdown', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAdminRoutes(page);
  });

  test('AdminCustomers shows source_brand column and filter dropdown defaults to All', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/customers`);
    const select = page.getByTestId('filter-source-brand');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('');
    await expect(page.getByTestId('admin-customer-row')).toHaveCount(3);
    const brands = await page.getByTestId('row-source-brand').allTextContents();
    expect(brands.sort()).toEqual(['nixbot', 'nixbot', 'phonepilot']);
  });

  test('AdminCustomers filter by nixbot persists in URL and only nixbot rows shown', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/customers`);
    await page.getByTestId('filter-source-brand').selectOption('nixbot');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('admin-customer-row')).toHaveCount(2);
    for (const cell of await page.getByTestId('row-source-brand').all()) {
      await expect(cell).toHaveText('nixbot');
    }
    expect(page.url()).toMatch(/[?&]source_brand=nixbot\b/);
  });

  test('AdminCustomers filter by phonepilot returns only phonepilot rows', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/customers`);
    await page.getByTestId('filter-source-brand').selectOption('phonepilot');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('admin-customer-row')).toHaveCount(1);
    await expect(page.getByTestId('row-source-brand').first()).toHaveText('phonepilot');
  });

  test('AdminCustomers reads source_brand from URL on initial load', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/customers?source_brand=nixbot`);
    await expect(page.getByTestId('filter-source-brand')).toHaveValue('nixbot');
    await expect(page.getByTestId('admin-customer-row')).toHaveCount(2);
  });

  test('AdminOrders filter dropdown lists all configured brands', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders`);
    const select = page.getByTestId('filter-source-brand');
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('All brands');
    expect(options).toContain('nixbot');
    expect(options).toContain('phonepilot');
  });

  test('AdminOrders filter by phonepilot persists in URL and matches only that brand', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/orders`);
    await page.getByTestId('filter-source-brand').selectOption('phonepilot');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('admin-order-row')).toHaveCount(1);
    expect(page.url()).toMatch(/[?&]source_brand=phonepilot\b/);
  });

  test('AdminSubscriptions filter by nixbot persists in URL and matches only that brand', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    await page.getByTestId('filter-source-brand').selectOption('nixbot');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('admin-subscription-row')).toHaveCount(1);
    expect(page.url()).toMatch(/[?&]source_brand=nixbot\b/);
  });
});
