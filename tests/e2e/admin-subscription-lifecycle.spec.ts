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

const SUB_ID = '33333333-3333-3333-3333-333333333333';
const NEXT_RENEWAL = '2026-05-26T11:00:00Z';

interface Assignment {
  id: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
  pending_creation?: boolean;
}

interface DetailFixture {
  id: string;
  created_at: string;
  customer_id: string;
  customer_email: string;
  sku_id: string;
  sku_code: string;
  sku_metadata_json: Record<string, unknown>;
  source_brand: string;
  state: string;
  required_account_count: number | null;
  started_at: string | null;
  next_renewal_at: string | null;
  last_renewed_at: string | null;
  activated_by: string | null;
  cancel_at_cycle: number | null;
  metadata_json: Record<string, unknown>;
  assignments: Assignment[];
}

const PRE_ACTIVATION: DetailFixture = {
  id: SUB_ID,
  created_at: '2026-04-26T10:00:00Z',
  customer_id: 'c1',
  customer_email: 'lifecycle@example.com',
  sku_id: 'sk1',
  sku_code: 'managed-3',
  sku_metadata_json: { account_count: 3, posts_per_week: 5 },
  source_brand: 'nixbot',
  state: 'pending_activation',
  required_account_count: 3,
  started_at: null,
  next_renewal_at: null,
  last_renewed_at: null,
  activated_by: null,
  cancel_at_cycle: null,
  metadata_json: {},
  assignments: [
    {
      id: 'a1',
      account_id: 'acc1',
      username: 'ig_lc_1',
      status: 'active',
      warmup_days: 9,
      started_at: '2026-04-25T10:00:00Z',
    },
    {
      id: 'a2',
      account_id: 'acc2',
      username: 'ig_lc_2',
      status: 'active',
      warmup_days: 7,
      started_at: '2026-04-25T10:00:00Z',
    },
    {
      id: 'a3',
      account_id: 'acc3',
      username: 'ig_lc_3',
      status: 'warming',
      warmup_days: 4,
      started_at: '2026-04-25T10:00:00Z',
    },
  ],
};

test.describe('admin-ui-subscriptions: lifecycle activate → pause → resume → cancel', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  let detail: DetailFixture;
  const calls: { activate: number; pause: number; resume: number; cancel: number } = {
    activate: 0,
    pause: 0,
    resume: 0,
    cancel: 0,
  };

  test.beforeEach(async ({ page }) => {
    detail = JSON.parse(JSON.stringify(PRE_ACTIVATION)) as DetailFixture;
    calls.activate = 0;
    calls.pause = 0;
    calls.resume = 0;
    calls.cancel = 0;

    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );

    await page.route(`**/api/admin/subscriptions/${SUB_ID}/activate`, async (route) => {
      calls.activate += 1;
      detail.state = 'active';
      detail.activated_by = 'adm_1';
      detail.started_at = '2026-04-26T13:00:00Z';
      detail.next_renewal_at = NEXT_RENEWAL;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscription_id: SUB_ID, state: 'active' }),
      });
    });

    await page.route(`**/api/admin/subscriptions/${SUB_ID}/pause`, async (route) => {
      calls.pause += 1;
      detail.state = 'paused';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscription_id: SUB_ID, state: 'paused' }),
      });
    });

    await page.route(`**/api/admin/subscriptions/${SUB_ID}/resume`, async (route) => {
      calls.resume += 1;
      detail.state = 'active';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscription_id: SUB_ID, state: 'active' }),
      });
    });

    await page.route(`**/api/admin/subscriptions/${SUB_ID}/cancel`, async (route) => {
      calls.cancel += 1;
      detail.state = 'pending_cancellation';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription_id: SUB_ID,
          state: 'pending_cancellation_or_cancelled',
        }),
      });
    });

    await page.route('**/api/admin/operator-accounts/idle*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [] }),
      }),
    );

    await page.route(`**/api/admin/subscriptions/${SUB_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      }),
    );

    await page.route('**/api/admin/subscriptions*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/subscriptions') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ subscriptions: [] }),
        });
        return;
      }
      await route.fallback();
    });
  });

  test('activate disabled with tooltip until enough accounts attached', async ({ page }) => {
    detail.assignments = detail.assignments.slice(0, 2);
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    const activate = page.getByTestId('subscription-activate-button');
    await expect(activate).toBeDisabled();
    const title = await activate.getAttribute('title');
    expect(title ?? '').toMatch(/3.*account|exactly 3/i);
    await expect(page.getByTestId('activate-count-warning')).toBeVisible();
  });

  test('full lifecycle: activate → pause → resume → cancel', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('subscription-state-badge')).toHaveText('pending_activation');

    const activate = page.getByTestId('subscription-activate-button');
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect(page).toHaveURL(/\/admin\/subscriptions$/);
    expect(calls.activate).toBe(1);

    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('subscription-state-badge')).toHaveText('active');
    await expect(page.getByTestId('subscription-pause-button')).toBeVisible();
    await expect(page.getByTestId('subscription-resume-button')).toHaveCount(0);

    await page.getByTestId('subscription-pause-button').click();
    await expect(page.getByTestId('subscription-state-badge')).toHaveText('paused');
    expect(calls.pause).toBe(1);
    await expect(page.getByTestId('subscription-resume-button')).toBeVisible();
    await expect(page.getByTestId('subscription-pause-button')).toHaveCount(0);

    await page.getByTestId('subscription-resume-button').click();
    await expect(page.getByTestId('subscription-state-badge')).toHaveText('active');
    expect(calls.resume).toBe(1);

    await page.getByTestId('subscription-cancel-button').click();
    const dialog = page.getByTestId('cancel-dialog');
    await expect(dialog).toBeVisible();
    const notice = page.getByTestId('cancel-end-of-cycle-notice');
    await expect(notice).toContainText('no refund');
    await expect(notice).toContainText('pending_cancellation');
    await expect(page.getByTestId('cancel-end-date')).not.toHaveText('—');
    await page.getByTestId('cancel-dialog-confirm').click();
    await expect(page).toHaveURL(/\/admin\/subscriptions$/);
    expect(calls.cancel).toBe(1);
  });
});
