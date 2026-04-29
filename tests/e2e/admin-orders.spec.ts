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

const ADMIN_TOKEN = fakeJwt({
  user_id: 'adm_1',
  is_admin: true,
  exp: Math.floor(Date.now() / 1000) + 900,
});

interface OrderRow {
  id: string;
  created_at: string;
  customer_email: string;
  source_brand: string;
  sku_code: string;
  state: string;
  posts_done: number;
  posts_total: number;
  started_by?: string | null;
}

const FIXTURE: OrderRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-04-26T10:00:00Z',
    customer_email: 'pending1@example.com',
    source_brand: 'nixbot',
    sku_code: 'reels-10',
    state: 'pending',
    posts_done: 0,
    posts_total: 10,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    created_at: '2026-04-26T11:00:00Z',
    customer_email: 'active1@example.com',
    source_brand: 'phonepilot',
    sku_code: 'reels-50',
    state: 'active',
    posts_done: 12,
    posts_total: 50,
    started_by: 'adm_1',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    created_at: '2026-04-26T12:00:00Z',
    customer_email: 'pending2@example.com',
    source_brand: 'nixbot',
    sku_code: 'reels-25',
    state: 'pending',
    posts_done: 0,
    posts_total: 25,
  },
];

test.describe('admin-ui-orders: /admin/orders list', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );
    await page.route('**/api/admin/orders*', async (route) => {
      const url = new URL(route.request().url());
      const state = url.searchParams.get('state');
      const sourceBrand = url.searchParams.get('source_brand');
      let rows = FIXTURE.slice();
      if (state) rows = rows.filter((r) => r.state === state);
      if (sourceBrand) rows = rows.filter((r) => r.source_brand === sourceBrand);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: rows }),
      });
    });
  });

  test('renders all rows with filter and sort controls', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders`);
    await expect(page.getByTestId('admin-orders-filters')).toBeVisible();
    await expect(page.getByTestId('filter-state')).toBeVisible();
    await expect(page.getByTestId('filter-source-brand')).toBeVisible();
    await expect(page.getByTestId('sort-by')).toBeVisible();
    await expect(page.getByTestId('sort-dir')).toBeVisible();
    await expect(page.getByTestId('admin-order-row')).toHaveCount(3);
  });

  test('filter by state=pending shows only pending rows and persists in URL', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders`);
    await expect(page.getByTestId('admin-order-row')).toHaveCount(3);
    await page.getByTestId('filter-state').selectOption('pending');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('admin-order-row')).toHaveCount(2);
    for (const cell of await page.getByTestId('row-state').all()) {
      await expect(cell).toHaveText('pending');
    }
    expect(page.url()).toMatch(/[?&]state=pending\b/);
  });

  test('reads filters from URL on initial load', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders?state=pending`);
    await expect(page.getByTestId('admin-order-row')).toHaveCount(2);
    await expect(page.getByTestId('filter-state')).toHaveValue('pending');
  });

  test('clicking a row navigates to /admin/orders/:id', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders`);
    const firstLink = page.getByTestId('admin-order-link').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/admin\/orders\/[0-9a-f-]+$/);
    await firstLink.click();
    await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]+$/);
  });

  test('empty state renders when no orders match', async ({ page }) => {
    await page.unroute('**/api/admin/orders*');
    await page.route('**/api/admin/orders*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [] }),
      }),
    );
    await page.goto(`${UI_BASE}/admin/orders`);
    await expect(page.getByTestId('admin-orders-empty')).toBeVisible();
  });
});
