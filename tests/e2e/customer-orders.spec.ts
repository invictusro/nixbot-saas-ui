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

interface OrderRow {
  id: string;
  created_at: string;
  sku_code: string;
  sku_name: string;
  state: string;
  posts_total: number;
  posts_done: number;
  source_brand: string;
}

const FIXTURE: OrderRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-04-26T10:00:00Z',
    sku_code: 'reels_10pack',
    sku_name: 'Reels Orders',
    state: 'pending',
    posts_total: 10,
    posts_done: 0,
    source_brand: 'nixbot',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    created_at: '2026-04-26T11:00:00Z',
    sku_code: 'reels_50pack',
    sku_name: 'Reels Orders',
    state: 'completed',
    posts_total: 50,
    posts_done: 50,
    source_brand: 'phonepilot',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    created_at: '2026-04-26T12:00:00Z',
    sku_code: 'reels_100pack',
    sku_name: 'Reels Orders',
    state: 'active',
    posts_total: 100,
    posts_done: 25,
    source_brand: 'nixbot',
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
}

test.describe('customer-ui-orders: /orders list', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await page.route('**/api/customer/orders*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: FIXTURE }),
      }),
    );
  });

  test('renders all order rows with progress bars', async ({ page }) => {
    await page.goto(`${UI_BASE}/orders`);
    await expect(page.getByTestId('customer-orders')).toBeVisible();
    await expect(page.getByTestId('customer-order-row')).toHaveCount(3);
    const bars = await page.getByTestId('customer-order-progress-bar').all();
    expect(bars).toHaveLength(3);
    expect(await bars[0].getAttribute('data-percent')).toBe('0');
    expect(await bars[1].getAttribute('data-percent')).toBe('100');
    expect(await bars[2].getAttribute('data-percent')).toBe('25');
  });

  test('clicking a row navigates to /orders/:id', async ({ page }) => {
    await page.goto(`${UI_BASE}/orders`);
    const firstLink = page.getByTestId('customer-order-link').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/orders\/[0-9a-f-]+$/);
    await firstLink.click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
  });

  test('empty state renders when customer has no orders', async ({ page }) => {
    await page.unroute('**/api/customer/orders*');
    await page.route('**/api/customer/orders*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [] }),
      }),
    );
    await page.goto(`${UI_BASE}/orders`);
    await expect(page.getByTestId('customer-orders-empty')).toBeVisible();
  });

  test('nav link hidden for customer with no orders', async ({ page }) => {
    await page.unroute('**/api/customer/orders*');
    await page.route('**/api/customer/orders*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [] }),
      }),
    );
    await page.goto(`${UI_BASE}/dashboard`);
    await expect(page.getByTestId('customer-orders-nav-link')).toHaveCount(0);
  });
});
