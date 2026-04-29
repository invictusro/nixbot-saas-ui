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

const PENDING_ID = '11111111-1111-1111-1111-111111111111';
const ACTIVE_ID = '22222222-2222-2222-2222-222222222222';

interface DetailFixture {
  id: string;
  customer_id: string;
  customer_email: string;
  sku_id: string;
  sku_code: string;
  sku_metadata_json: Record<string, unknown>;
  source_brand: string;
  state: string;
  posts_total: number;
  posts_done: number;
  posts_per_day?: number | null;
  active_hours_start?: number | null;
  active_hours_end?: number | null;
  account_pool_filter_json: Record<string, unknown>;
  started_by?: string | null;
  started_at?: string | null;
  created_at: string;
}

const PENDING: DetailFixture = {
  id: PENDING_ID,
  customer_id: 'c1',
  customer_email: 'pending@example.com',
  sku_id: 's1',
  sku_code: 'reels-10',
  sku_metadata_json: { reel_count: 10, default_posts_per_day: 2 },
  source_brand: 'nixbot',
  state: 'pending',
  posts_total: 10,
  posts_done: 0,
  account_pool_filter_json: {},
  created_at: '2026-04-26T10:00:00Z',
};

const ACTIVE: DetailFixture = {
  id: ACTIVE_ID,
  customer_id: 'c2',
  customer_email: 'active@example.com',
  sku_id: 's1',
  sku_code: 'reels-50',
  sku_metadata_json: { reel_count: 50 },
  source_brand: 'phonepilot',
  state: 'active',
  posts_total: 50,
  posts_done: 12,
  posts_per_day: 3,
  active_hours_start: 9,
  active_hours_end: 21,
  account_pool_filter_json: { min_warmup_days: 5 },
  started_by: 'adm_1',
  started_at: '2026-04-26T11:00:00Z',
  created_at: '2026-04-26T10:00:00Z',
};

let detailState: 'pending' | 'active' = 'pending';
let lastStartBody: unknown = null;
let lastPreviewBody: unknown = null;
let previewCallCount = 0;
type PreviewResp = { matching_accounts_count: number; estimated_completion_days: number | null };
let nextPreview: PreviewResp = { matching_accounts_count: 0, estimated_completion_days: null };

test.describe('admin-ui-orders: /admin/orders/:id detail', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    detailState = 'pending';
    lastStartBody = null;
    lastPreviewBody = null;
    previewCallCount = 0;
    nextPreview = { matching_accounts_count: 0, estimated_completion_days: null };
    await page.route(`**/api/admin/orders/${PENDING_ID}/pool-preview`, async (route) => {
      previewCallCount += 1;
      lastPreviewBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(nextPreview),
      });
    });
    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );
    await page.route(`**/api/admin/orders/${PENDING_ID}/start`, async (route) => {
      lastStartBody = JSON.parse(route.request().postData() ?? '{}');
      detailState = 'active';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ order_id: PENDING_ID, state: 'active' }),
      });
    });
    await page.route(`**/api/admin/orders/${PENDING_ID}`, async (route) => {
      const body =
        detailState === 'active'
          ? { ...PENDING, state: 'active', started_by: 'adm_1', started_at: '2026-04-26T12:00:00Z', posts_per_day: 2, active_hours_start: 9, active_hours_end: 21 }
          : PENDING;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.route(`**/api/admin/orders/${ACTIVE_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ACTIVE),
      }),
    );
    await page.route('**/api/admin/orders*', async (route) => {
      const url = new URL(route.request().url());
      // bare list path used for navigate-back
      if (url.pathname === '/api/admin/orders') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ orders: [] }),
        });
        return;
      }
      await route.fallback();
    });
  });

  test('renders all fields for an active order', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${ACTIVE_ID}`);
    await expect(page.getByTestId('admin-order-detail')).toBeVisible();
    await expect(page.getByTestId('order-customer-email')).toHaveText('active@example.com');
    await expect(page.getByTestId('order-source-brand')).toHaveText('phonepilot');
    await expect(page.getByTestId('order-progress')).toHaveText('12/50');
    await expect(page.getByTestId('order-state-badge')).toHaveText('active');
    await expect(page.getByTestId('order-started-by')).toHaveText('adm_1');
    await expect(page.getByTestId('order-sku-metadata')).toContainText('reel_count');
    await expect(page.getByTestId('order-config-form')).toHaveCount(0);
  });

  test('config form only appears when state=pending and Start gates on required fields', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await expect(page.getByTestId('order-config-form')).toBeVisible();
    const start = page.getByTestId('order-start-button');
    await expect(start).toBeDisabled();
    await page.getByTestId('cfg-posts-per-day').fill('2');
    await expect(start).toBeDisabled();
    await page.getByTestId('cfg-ahs').fill('9');
    await expect(start).toBeDisabled();
    await page.getByTestId('cfg-ahe').fill('21');
    await expect(start).toBeEnabled();
  });

  test('successful start posts config and navigates to list with toast', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await page.getByTestId('cfg-posts-per-day').fill('2');
    await page.getByTestId('cfg-ahs').fill('9');
    await page.getByTestId('cfg-ahe').fill('21');
    await page.getByTestId('cfg-pool-filter').fill('{"min_warmup_days": 5}');
    await page.getByTestId('order-start-button').click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    await expect(page.getByTestId('admin-orders-toast')).toBeVisible();
    expect(lastStartBody).toEqual({
      posts_per_day: 2,
      active_hours_start: 9,
      active_hours_end: 21,
      account_pool_filter_json: { min_warmup_days: 5 },
    });
  });

  test('pool preview widget live-updates as filter and posts/day change', async ({ page }) => {
    nextPreview = { matching_accounts_count: 5, estimated_completion_days: null };
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await expect(page.getByTestId('pool-preview-widget')).toBeVisible();
    await expect(page.getByTestId('pool-preview-count')).toHaveText('5');
    nextPreview = { matching_accounts_count: 3, estimated_completion_days: 5 };
    await page.getByTestId('cfg-posts-per-day').fill('2');
    await page.getByTestId('cfg-pool-filter').fill('{"min_warmup_days": 14}');
    await expect(page.getByTestId('pool-preview-count')).toHaveText('3');
    await expect(page.getByTestId('pool-preview-days')).toHaveText('5');
    expect(lastPreviewBody).toEqual({
      account_pool_filter_json: { min_warmup_days: 14 },
      posts_per_day: 2,
    });
  });

  test('invalid pool filter JSON shows preview error and does not break the page', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await page.getByTestId('cfg-pool-filter').fill('{not json');
    await expect(page.getByTestId('pool-preview-error')).toBeVisible();
    await expect(page.getByTestId('admin-order-detail')).toBeVisible();
  });

  test('invalid pool filter JSON disables Start', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await page.getByTestId('cfg-posts-per-day').fill('2');
    await page.getByTestId('cfg-ahs').fill('9');
    await page.getByTestId('cfg-ahe').fill('21');
    await page.getByTestId('cfg-pool-filter').fill('not json');
    await expect(page.getByTestId('cfg-pool-filter-error')).toBeVisible();
    await expect(page.getByTestId('order-start-button')).toBeDisabled();
  });
});

test.describe('admin-ui-orders: pause / resume / cancel actions', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  let currentState: 'pending' | 'active' | 'paused' | 'cancelled' = 'active';
  let lastCancelBody: unknown = null;
  let pauseHits = 0;
  let resumeHits = 0;

  function detailFor(state: typeof currentState): DetailFixture & { state: string } {
    if (state === 'pending') return { ...PENDING };
    return {
      ...ACTIVE,
      state,
    };
  }

  test.beforeEach(async ({ page }) => {
    currentState = 'active';
    lastCancelBody = null;
    pauseHits = 0;
    resumeHits = 0;

    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );

    await page.route(`**/api/admin/orders/${ACTIVE_ID}/pause`, async (route) => {
      pauseHits += 1;
      currentState = 'paused';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ order_id: ACTIVE_ID, state: 'paused' }),
      });
    });

    await page.route(`**/api/admin/orders/${ACTIVE_ID}/resume`, async (route) => {
      resumeHits += 1;
      currentState = 'active';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ order_id: ACTIVE_ID, state: 'active' }),
      });
    });

    await page.route(`**/api/admin/orders/${ACTIVE_ID}/cancel`, async (route) => {
      const raw = route.request().postData();
      lastCancelBody = raw ? JSON.parse(raw) : null;
      currentState = 'cancelled';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          order_id: ACTIVE_ID,
          state: 'cancelled',
          refunded: false,
        }),
      });
    });

    await page.route(`**/api/admin/orders/${ACTIVE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailFor(currentState)),
      });
    });

    await page.route(`**/api/admin/orders/${PENDING_ID}/cancel`, async (route) => {
      const raw = route.request().postData();
      lastCancelBody = raw ? JSON.parse(raw) : null;
      currentState = 'cancelled';
      const body =
        lastCancelBody && (lastCancelBody as { refund?: boolean }).refund
          ? {
              order_id: PENDING_ID,
              state: 'cancelled',
              refunded: true,
              amount_cents: 4999,
              transaction_id: 't-9',
            }
          : { order_id: PENDING_ID, state: 'cancelled', refunded: false };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    await page.route(`**/api/admin/orders/${PENDING_ID}/pool-preview`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ matching_accounts_count: 0, estimated_completion_days: null }),
      }),
    );

    await page.route(`**/api/admin/orders/${PENDING_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PENDING),
      }),
    );

    await page.route('**/api/admin/orders*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/orders') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ orders: [] }),
        });
        return;
      }
      await route.fallback();
    });
  });

  test('pause flips active → paused, then resume flips back', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${ACTIVE_ID}`);
    await expect(page.getByTestId('order-state-badge')).toHaveText('active');
    await page.getByTestId('order-pause-button').click();
    await expect(page.getByTestId('order-state-badge')).toHaveText('paused');
    expect(pauseHits).toBe(1);

    await page.getByTestId('order-resume-button').click();
    await expect(page.getByTestId('order-state-badge')).toHaveText('active');
    expect(resumeHits).toBe(1);
  });

  test('cancel on pending order with refund checkbox sends refund=true', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await page.getByTestId('order-cancel-button').click();
    await expect(page.getByTestId('cancel-dialog')).toBeVisible();
    await expect(page.getByTestId('cancel-refund-checkbox')).toBeChecked();
    await expect(page.getByTestId('cancel-no-refund-warning')).toHaveCount(0);
    await page.getByTestId('cancel-dialog-confirm').click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    await expect(page.getByTestId('admin-orders-toast')).toBeVisible();
    await expect(page.getByTestId('admin-orders-toast')).toContainText('refunded');
    expect(lastCancelBody).toEqual({ refund: true });
  });

  test('cancel on pending order with refund unchecked sends refund=false', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${PENDING_ID}`);
    await page.getByTestId('order-cancel-button').click();
    await page.getByTestId('cancel-refund-checkbox').uncheck();
    await page.getByTestId('cancel-dialog-confirm').click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    expect(lastCancelBody).toEqual({ refund: false });
  });

  test('cancel on active order shows no-refund warning and does NOT send refund', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${ACTIVE_ID}`);
    await page.getByTestId('order-cancel-button').click();
    await expect(page.getByTestId('cancel-dialog')).toBeVisible();
    await expect(page.getByTestId('cancel-no-refund-warning')).toBeVisible();
    await expect(page.getByTestId('cancel-refund-checkbox')).toHaveCount(0);
    await page.getByTestId('cancel-dialog-confirm').click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    expect(lastCancelBody).toBeNull();
  });

  test('cancel dialog dismisses without firing the request', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/orders/${ACTIVE_ID}`);
    await page.getByTestId('order-cancel-button').click();
    await page.getByTestId('cancel-dialog-dismiss').click();
    await expect(page.getByTestId('cancel-dialog')).toHaveCount(0);
    expect(lastCancelBody).toBeNull();
    await expect(page.getByTestId('order-state-badge')).toHaveText('active');
  });
});
