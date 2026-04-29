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

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const POSTED_URL = 'https://www.instagram.com/reel/abc123/';

const DETAIL_FIXTURE = {
  id: ORDER_ID,
  created_at: '2026-04-20T09:00:00Z',
  completed_at: null,
  sku_code: 'reels_10pack',
  sku_name: 'Reels Orders',
  state: 'active',
  posts_total: 10,
  posts_done: 2,
  source_brand: 'nixbot',
  deliveries: [
    {
      id: 'd1',
      posted_at: '2026-04-20T10:00:00Z',
      state: 'posted',
      ig_post_url: POSTED_URL,
    },
    {
      id: 'd2',
      posted_at: '2026-04-20T11:00:00Z',
      state: 'failed',
    },
    {
      id: 'd3',
      posted_at: '2026-04-20T12:00:00Z',
      state: 'missing',
    },
  ],
};

const EMPTY_TIMELINE_FIXTURE = {
  ...DETAIL_FIXTURE,
  state: 'pending',
  posts_done: 0,
  deliveries: [],
};

async function mockAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/refresh', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: CUSTOMER_TOKEN, token_type: 'Bearer' }),
    }),
  );
}

test.describe('customer-ui-orders: /orders/:id detail', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('renders timeline with posted/failed/missing rows + IG link', async ({ page }) => {
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await expect(page.getByTestId('customer-order-detail')).toBeVisible();
    await expect(page.getByTestId('customer-order-detail-state')).toHaveText('active');
    await expect(page.getByTestId('customer-order-detail-progress-bar')).toHaveAttribute(
      'data-percent',
      '20',
    );

    const rows = page.getByTestId('customer-order-delivery');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'posted');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'failed');
    await expect(rows.nth(2)).toHaveAttribute('data-state', 'missing');

    const link = page.getByTestId('customer-order-delivery-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', POSTED_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);

    const failedIcon = rows.nth(1).getByTestId('customer-order-delivery-icon');
    await expect(failedIcon).toHaveAttribute('title', /fail/i);
    const missingIcon = rows.nth(2).getByTestId('customer-order-delivery-icon');
    await expect(missingIcon).toHaveAttribute('title', /no longer visible|removed|missing/i);
  });

  test('does not expose operator/account fields in payload or DOM', async ({ page }) => {
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await expect(page.getByTestId('customer-order-timeline')).toBeVisible();
    const html = await page.content();
    for (const leak of ['account_id', 'account_username', 'operator', 'username']) {
      expect(html.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    // The fixture itself never sends these fields — this is the
    // "customer sees exactly their posts + no operator info" guard.
    expect(JSON.stringify(DETAIL_FIXTURE)).not.toMatch(/account|operator|username/i);
  });

  test('empty timeline renders the empty-state copy', async ({ page }) => {
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_TIMELINE_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await expect(page.getByTestId('customer-order-timeline-empty')).toBeVisible();
    await expect(page.getByTestId('customer-order-delivery')).toHaveCount(0);
  });

  test('404 from API renders not-found copy', async ({ page }) => {
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'order not found' }),
      }),
    );
    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await expect(page.getByTestId('customer-order-detail-error')).toContainText('not found');
  });
});
