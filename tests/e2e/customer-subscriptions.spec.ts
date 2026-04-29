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

interface SubscriptionRow {
  id: string;
  created_at: string;
  sku_code: string;
  sku_name: string;
  state: string;
  next_renewal_at?: string | null;
  monthly_price_cents: number;
  source_brand: string;
}

const FIXTURE: SubscriptionRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-04-15T10:00:00Z',
    sku_code: 'managed_3acc_1mo',
    sku_name: 'Managed Posting',
    state: 'active',
    next_renewal_at: '2026-05-15T10:00:00Z',
    monthly_price_cents: 19900,
    source_brand: 'phonepilot',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    created_at: '2026-04-10T11:00:00Z',
    sku_code: 'managed_5acc_1mo',
    sku_name: 'Managed Posting',
    state: 'pending_cancellation',
    next_renewal_at: '2026-05-10T11:00:00Z',
    monthly_price_cents: 29900,
    source_brand: 'phonepilot',
  },
];

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
}

test.describe('customer-ui-subscriptions: /subscriptions list', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await page.route('**/api/customer/subscriptions*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: FIXTURE }),
      }),
    );
  });

  test('renders all subscription rows with sku, state, next renewal, price', async ({ page }) => {
    await page.goto(`${UI_BASE}/subscriptions`);
    await expect(page.getByTestId('customer-subscriptions')).toBeVisible();
    await expect(page.getByTestId('customer-subscription-row')).toHaveCount(2);

    const renewals = await page.getByTestId('customer-subscription-next-renewal').allTextContents();
    expect(renewals).toHaveLength(2);
    // Human-formatted date — not raw ISO.
    expect(renewals[0]).not.toMatch(/T\d{2}:\d{2}/);
    expect(renewals[0]).toMatch(/\b\d{4}\b/); // year present
    expect(renewals[0]).toMatch(/[A-Za-z]{3}/); // month abbrev

    const monthlyCells = page.getByTestId('customer-subscription-monthly');
    expect(await monthlyCells.first().getAttribute('data-cents')).toBe('19900');
    await expect(monthlyCells.first()).toHaveText('$199.00');
    await expect(monthlyCells.nth(1)).toHaveText('$299.00');
  });

  test('pending_cancellation row is visually distinguished', async ({ page }) => {
    await page.goto(`${UI_BASE}/subscriptions`);
    const pendingCancelRow = page.locator('[data-testid="customer-subscription-row"][data-state="pending_cancellation"]');
    await expect(pendingCancelRow).toHaveCount(1);
    const pill = pendingCancelRow.getByTestId('customer-subscription-state');
    await expect(pill).toHaveText('cancelling');
    const cls = (await pill.getAttribute('class')) ?? '';
    expect(cls).toMatch(/rose|amber|red/i);
    expect(cls).toMatch(/ring/);
  });

  test('clicking a row navigates to /subscriptions/:id', async ({ page }) => {
    await page.goto(`${UI_BASE}/subscriptions`);
    const firstLink = page.getByTestId('customer-subscription-link').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/subscriptions\/[0-9a-f-]+$/);
    await firstLink.click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]+$/);
  });

  test('empty state renders when customer has no subscriptions', async ({ page }) => {
    await page.unroute('**/api/customer/subscriptions*');
    await page.route('**/api/customer/subscriptions*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: [] }),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions`);
    await expect(page.getByTestId('customer-subscriptions-empty')).toBeVisible();
  });

  test('nav link hidden for customer with no subscriptions', async ({ page }) => {
    await page.unroute('**/api/customer/subscriptions*');
    await page.route('**/api/customer/subscriptions*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: [] }),
      }),
    );
    await page.goto(`${UI_BASE}/dashboard`);
    await expect(page.getByTestId('customer-subscriptions-nav-link')).toHaveCount(0);
  });
});
