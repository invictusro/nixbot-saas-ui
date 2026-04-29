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

const REVENUE_BY_TIMEFRAME: Record<string, { brand_code: string; total_customers: number; active_orders: number; active_subscriptions: number; mrr_cents: number; revenue_cents: number }[]> = {
  '7': [
    { brand_code: 'nixbot',     total_customers: 12, active_orders: 1, active_subscriptions: 2, mrr_cents: 19800, revenue_cents:  3000 },
    { brand_code: 'phonepilot', total_customers:  4, active_orders: 0, active_subscriptions: 1, mrr_cents: 12900, revenue_cents:  0    },
  ],
  '30': [
    { brand_code: 'nixbot',     total_customers: 12, active_orders: 3, active_subscriptions: 5, mrr_cents: 49500, revenue_cents: 12000 },
    { brand_code: 'phonepilot', total_customers:  4, active_orders: 1, active_subscriptions: 2, mrr_cents: 25800, revenue_cents:  3000 },
  ],
  '90': [
    { brand_code: 'nixbot',     total_customers: 18, active_orders: 5, active_subscriptions: 7, mrr_cents: 69300, revenue_cents: 30000 },
    { brand_code: 'phonepilot', total_customers:  6, active_orders: 2, active_subscriptions: 3, mrr_cents: 38700, revenue_cents:  9900 },
  ],
};

async function mockAdminRoutes(page: Page): Promise<void> {
  await page.route('**/api/auth/refresh', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
    }),
  );
  await page.route('**/api/admin/revenue*', async (route) => {
    const url = new URL(route.request().url());
    const days = url.searchParams.get('timeframe_days') ?? '30';
    const brands = REVENUE_BY_TIMEFRAME[days] ?? REVENUE_BY_TIMEFRAME['30'];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ timeframe_days: Number(days), brands }),
    });
  });
}

test.describe('admin-revenue: per-brand dashboard', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await mockAdminRoutes(page);
  });

  test('renders one card per brand with all four metrics', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/revenue`);
    await expect(page.getByTestId('revenue-cards')).toBeVisible();
    await expect(page.getByTestId('revenue-card')).toHaveCount(2);

    const nixbot = page.getByTestId('revenue-card').filter({ hasText: 'nixbot' }).first();
    await expect(nixbot.getByTestId('card-customers')).toHaveText('12');
    await expect(nixbot.getByTestId('card-active-orders')).toHaveText('3');
    await expect(nixbot.getByTestId('card-active-subscriptions')).toHaveText('5');
    await expect(nixbot.getByTestId('card-mrr')).toHaveText('$495.00');
    await expect(nixbot.getByTestId('card-revenue')).toHaveText('$120.00');
  });

  test('timeframe selector switches between 7/30/90 days', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/revenue`);
    const select = page.getByTestId('revenue-timeframe');
    await expect(select).toHaveValue('30');

    await select.selectOption('7');
    const nx7 = page.getByTestId('revenue-card').filter({ hasText: 'nixbot' }).first();
    await expect(nx7.getByTestId('card-revenue')).toHaveText('$30.00');
    expect(page.url()).toMatch(/[?&]timeframe_days=7\b/);

    await select.selectOption('90');
    const nx90 = page.getByTestId('revenue-card').filter({ hasText: 'nixbot' }).first();
    await expect(nx90.getByTestId('card-revenue')).toHaveText('$300.00');
    expect(page.url()).toMatch(/[?&]timeframe_days=90\b/);
  });

  test('honours initial timeframe_days URL param', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/revenue?timeframe_days=90`);
    await expect(page.getByTestId('revenue-timeframe')).toHaveValue('90');
    const nixbot = page.getByTestId('revenue-card').filter({ hasText: 'nixbot' }).first();
    await expect(nixbot.getByTestId('card-customers')).toHaveText('18');
  });
});
