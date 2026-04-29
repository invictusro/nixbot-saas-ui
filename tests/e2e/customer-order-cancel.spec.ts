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

const PENDING_FIXTURE = {
  id: ORDER_ID,
  created_at: '2026-04-20T09:00:00Z',
  completed_at: null,
  sku_code: 'reels_10pack',
  sku_name: 'Reels Orders',
  state: 'pending',
  posts_total: 10,
  posts_done: 0,
  source_brand: 'nixbot',
  deliveries: [],
};

const ACTIVE_FIXTURE = { ...PENDING_FIXTURE, state: 'active', posts_done: 2 };
const COMPLETED_FIXTURE = { ...PENDING_FIXTURE, state: 'completed', posts_done: 10 };

async function mockAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/refresh', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: CUSTOMER_TOKEN, token_type: 'Bearer' }),
    }),
  );
}

test.describe('customer-ui-orders: /orders/:id cancel', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('cancel button only appears for state=pending', async ({ page }) => {
    for (const fixture of [ACTIVE_FIXTURE, COMPLETED_FIXTURE]) {
      await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fixture),
        }),
      );
      await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
      await expect(page.getByTestId('customer-order-detail-state')).toHaveText(fixture.state);
      await expect(page.getByTestId('customer-order-cancel-button')).toHaveCount(0);
      await page.unroute(`**/api/customer/orders/${ORDER_ID}`);
    }
  });

  test('confirm dialog explains the refund and cancel succeeds', async ({ page }) => {
    let detailCalls = 0;
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) => {
      detailCalls += 1;
      const body = detailCalls === 1
        ? PENDING_FIXTURE
        : { ...PENDING_FIXTURE, state: 'cancelled' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    let cancelCalled = false;
    await page.route(`**/api/customer/orders/${ORDER_ID}/cancel`, async (route) => {
      cancelCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          order_id: ORDER_ID,
          state: 'cancelled',
          refunded: true,
          amount_cents: 4900,
          transaction_id: 'txn_xyz',
        }),
      });
    });

    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await expect(page.getByTestId('customer-order-cancel-button')).toBeVisible();
    await page.getByTestId('customer-order-cancel-button').click();

    const dialog = page.getByTestId('customer-order-cancel-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/credited|balance/i);

    await page.getByTestId('customer-order-cancel-confirm').click();

    await expect(page.getByTestId('customer-order-cancel-success')).toContainText('$49.00');
    await expect(page.getByTestId('customer-order-detail-state')).toHaveText('cancelled');
    await expect(page.getByTestId('customer-order-cancel-button')).toHaveCount(0);
    expect(cancelCalled).toBe(true);
  });

  test('409 from server surfaces in the dialog without flipping state', async ({ page }) => {
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PENDING_FIXTURE),
      }),
    );
    await page.route(`**/api/customer/orders/${ORDER_ID}/cancel`, async (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'cancel only allowed while pending' }),
      }),
    );

    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await page.getByTestId('customer-order-cancel-button').click();
    await page.getByTestId('customer-order-cancel-confirm').click();

    await expect(page.getByTestId('customer-order-cancel-error')).toContainText(
      /no longer available|started/i,
    );
    await expect(page.getByTestId('customer-order-detail-state')).toHaveText('pending');
  });

  test('keep button dismisses the dialog without calling the API', async ({ page }) => {
    await page.route(`**/api/customer/orders/${ORDER_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PENDING_FIXTURE),
      }),
    );
    let cancelCalled = false;
    await page.route(`**/api/customer/orders/${ORDER_ID}/cancel`, async (route) => {
      cancelCalled = true;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(`${UI_BASE}/orders/${ORDER_ID}`);
    await page.getByTestId('customer-order-cancel-button').click();
    await page.getByTestId('customer-order-cancel-keep').click();
    await expect(page.getByTestId('customer-order-cancel-dialog')).toHaveCount(0);
    expect(cancelCalled).toBe(false);
  });
});
