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
const RENEWAL_ISO = '2026-05-15T10:30:00Z';

const ACTIVE_FIXTURE = {
  id: SUB_ID,
  created_at: '2026-04-15T10:00:00Z',
  sku_code: 'managed_3acc_1mo',
  sku_name: 'Managed Posting',
  state: 'active',
  started_at: '2026-04-15T10:30:00Z',
  next_renewal_at: RENEWAL_ISO,
  last_renewed_at: null,
  monthly_price_cents: 19900,
  source_brand: 'phonepilot',
  account_count: 3,
  posts_per_week: 5,
  cancel_at_cycle: null,
  assignments: [],
};

const PENDING_CANCELLATION_FIXTURE = { ...ACTIVE_FIXTURE, state: 'pending_cancellation' };
const CANCELLED_FIXTURE = { ...ACTIVE_FIXTURE, state: 'cancelled' };
const PAUSED_FIXTURE = { ...ACTIVE_FIXTURE, state: 'paused' };

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
      body: JSON.stringify({ subscriptions: [ACTIVE_FIXTURE] }),
    }),
  );
}

test.describe('customer-ui-subscriptions: /subscriptions/:id cancel', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('renewal banner renders next_renewal_at in the customer locale', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ACTIVE_FIXTURE),
      }),
    );

    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    const banner = page.getByTestId('customer-subscription-renewal-banner');
    await expect(banner).toBeVisible();

    const dateCell = page.getByTestId('customer-subscription-renewal-banner-date');
    const dateText = (await dateCell.textContent())?.trim() ?? '';
    expect(dateText).not.toMatch(/T\d|:\d{2}Z/);
    expect(dateText).toMatch(/\b\d{4}\b/);
    expect(dateText).toMatch(/[A-Za-z]{3,}/);

    const price = page.getByTestId('customer-subscription-renewal-banner-price');
    expect(await price.getAttribute('data-cents')).toBe('19900');
    await expect(price).toHaveText('$199.00');
  });

  test('cancel button shows confirmation with end-of-cycle messaging', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ACTIVE_FIXTURE),
      }),
    );

    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await page.getByTestId('customer-subscription-cancel-button').click();

    const dialog = page.getByTestId('customer-subscription-cancel-confirm');
    await expect(dialog).toBeVisible();
    const message = page.getByTestId('customer-subscription-cancel-confirm-message');
    await expect(message).toContainText(/until/i);
    await expect(message).toContainText(/no refund/i);
  });

  test('successful cancel flips state to pending_cancellation and shows the toast', async ({ page }) => {
    let detailCalls = 0;
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) => {
      detailCalls += 1;
      const body = detailCalls === 1 ? ACTIVE_FIXTURE : PENDING_CANCELLATION_FIXTURE;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    let cancelCalled = false;
    await page.route(`**/api/customer/subscriptions/${SUB_ID}/cancel`, async (route) => {
      cancelCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription_id: SUB_ID,
          state: 'pending_cancellation',
          ends_at: RENEWAL_ISO,
        }),
      });
    });

    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await page.getByTestId('customer-subscription-cancel-button').click();
    await page.getByTestId('customer-subscription-cancel-confirm-button').click();

    const toast = page.getByTestId('customer-subscription-cancel-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/no refund/i);

    await expect(page.getByTestId('customer-subscription-detail-state')).toHaveText('cancelling');
    await expect(page.getByTestId('customer-subscription-cancel-button')).toHaveCount(0);
    await expect(page.getByTestId('customer-subscription-renewal-banner')).toHaveCount(0);
    expect(cancelCalled).toBe(true);
  });

  test('paused subscription shows the cancel button', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PAUSED_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('customer-subscription-cancel-button')).toBeVisible();
  });

  test('already-cancelled subscription shows no cancel button and no banner', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CANCELLED_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('customer-subscription-detail')).toBeVisible();
    await expect(page.getByTestId('customer-subscription-cancel-button')).toHaveCount(0);
    await expect(page.getByTestId('customer-subscription-renewal-banner')).toHaveCount(0);
  });

  test('pending_cancellation subscription shows no cancel button (already cancelling)', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PENDING_CANCELLATION_FIXTURE),
      }),
    );
    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('customer-subscription-cancel-button')).toHaveCount(0);
    await expect(page.getByTestId('customer-subscription-renewal-banner')).toHaveCount(0);
  });

  test('409 from server surfaces in the dialog without flipping state', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ACTIVE_FIXTURE),
      }),
    );
    await page.route(`**/api/customer/subscriptions/${SUB_ID}/cancel`, async (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'cancel only allowed while active or paused' }),
      }),
    );

    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await page.getByTestId('customer-subscription-cancel-button').click();
    await page.getByTestId('customer-subscription-cancel-confirm-button').click();

    await expect(page.getByTestId('customer-subscription-cancel-error')).toContainText(/cannot/i);
    await expect(page.getByTestId('customer-subscription-detail-state')).toHaveText('active');
  });

  test('keep button dismisses the dialog without calling the API', async ({ page }) => {
    await page.route(`**/api/customer/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ACTIVE_FIXTURE),
      }),
    );
    let cancelCalled = false;
    await page.route(`**/api/customer/subscriptions/${SUB_ID}/cancel`, async (route) => {
      cancelCalled = true;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(`${UI_BASE}/subscriptions/${SUB_ID}`);
    await page.getByTestId('customer-subscription-cancel-button').click();
    await page.getByTestId('customer-subscription-cancel-dismiss').click();
    await expect(page.getByTestId('customer-subscription-cancel-confirm')).toHaveCount(0);
    expect(cancelCalled).toBe(false);
  });
});
