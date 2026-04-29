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

interface Assignment {
  id: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
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
  required_account_count?: number | null;
  started_at?: string | null;
  next_renewal_at?: string | null;
  last_renewed_at?: string | null;
  activated_by?: string | null;
  cancel_at_cycle?: number | null;
  metadata_json: Record<string, unknown>;
  assignments: Assignment[];
}

const PENDING_BASE: DetailFixture = {
  id: PENDING_ID,
  created_at: '2026-04-26T10:00:00Z',
  customer_id: 'c1',
  customer_email: 'pending@example.com',
  sku_id: 'sk1',
  sku_code: 'managed-3',
  sku_metadata_json: { account_count: 3, posts_per_week: 5 },
  source_brand: 'nixbot',
  state: 'pending_activation',
  required_account_count: 3,
  metadata_json: {},
  assignments: [],
};

const ACTIVE_FIXTURE: DetailFixture = {
  id: ACTIVE_ID,
  created_at: '2026-04-26T10:00:00Z',
  customer_id: 'c2',
  customer_email: 'active@example.com',
  sku_id: 'sk2',
  sku_code: 'managed-5',
  sku_metadata_json: { account_count: 5 },
  source_brand: 'phonepilot',
  state: 'active',
  required_account_count: 5,
  started_at: '2026-04-26T11:00:00Z',
  next_renewal_at: '2026-05-26T11:00:00Z',
  last_renewed_at: '2026-04-26T11:00:00Z',
  activated_by: 'adm_1',
  metadata_json: { start_warmup: true },
  assignments: [
    {
      id: 'a1',
      account_id: 'acc1',
      username: 'ig_user_1',
      status: 'active',
      warmup_days: 7,
      started_at: '2026-04-20T10:00:00Z',
    },
    {
      id: 'a2',
      account_id: 'acc2',
      username: 'ig_user_2',
      status: 'warming',
      warmup_days: 2,
      started_at: '2026-04-25T10:00:00Z',
    },
  ],
};

interface IdleFixture {
  id: string;
  username: string;
  niche: string | null;
  status: string;
  warmup_days: number;
  posting_enabled: boolean;
}

const IDLE_POOL: IdleFixture[] = [
  {
    id: 'acc-1',
    username: 'idle_user_1',
    niche: 'fitness',
    status: 'active',
    warmup_days: 12,
    posting_enabled: true,
  },
  {
    id: 'acc-2',
    username: 'idle_user_2',
    niche: 'fitness',
    status: 'active',
    warmup_days: 8,
    posting_enabled: true,
  },
  {
    id: 'acc-3',
    username: 'idle_user_3',
    niche: 'travel',
    status: 'active',
    warmup_days: 5,
    posting_enabled: true,
  },
  {
    id: 'acc-4',
    username: 'idle_user_4',
    niche: null,
    status: 'active',
    warmup_days: 3,
    posting_enabled: true,
  },
];

test.describe('admin-ui-subscriptions: /admin/subscriptions/:id detail', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  let pending: DetailFixture;
  let attached: Assignment[];
  let idlePool: IdleFixture[];
  let lastAllocBody: unknown = null;
  let activateHits = 0;

  test.beforeEach(async ({ page }) => {
    pending = JSON.parse(JSON.stringify(PENDING_BASE)) as DetailFixture;
    attached = [];
    idlePool = JSON.parse(JSON.stringify(IDLE_POOL)) as IdleFixture[];
    lastAllocBody = null;
    activateHits = 0;

    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );

    await page.route(`**/api/admin/subscriptions/${PENDING_ID}/allocate-accounts`, async (route) => {
      lastAllocBody = JSON.parse(route.request().postData() ?? '{}');
      const body = lastAllocBody as { account_ids: string[] };
      const created = body.account_ids.map((id, i) => {
        const idle = idlePool.find((p) => p.id === id);
        return {
          id: `assign-${attached.length + i + 1}`,
          account_id: id,
          username: idle ? idle.username : `ig_${id}`,
          status: 'ready',
          warmup_days: idle ? idle.warmup_days : 0,
          started_at: '2026-04-26T12:00:00Z',
        };
      });
      attached = [...attached, ...created];
      pending.assignments = attached;
      const attachedIds = new Set(body.account_ids);
      idlePool = idlePool.filter((p) => !attachedIds.has(p.id));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription_id: PENDING_ID,
          assignments: created.map((c) => ({ id: c.id, account_id: c.account_id })),
        }),
      });
    });

    await page.route('**/api/admin/operator-accounts/idle*', async (route) => {
      const url = new URL(route.request().url());
      const niche = url.searchParams.get('niche');
      const filtered = niche ? idlePool.filter((p) => p.niche === niche) : idlePool;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: filtered }),
      });
    });

    await page.route(`**/api/admin/subscriptions/${PENDING_ID}/activate`, async (route) => {
      activateHits += 1;
      pending.state = 'active';
      pending.activated_by = 'adm_1';
      pending.started_at = '2026-04-26T13:00:00Z';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscription_id: PENDING_ID, state: 'active' }),
      });
    });

    await page.route(`**/api/admin/subscriptions/${PENDING_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pending),
      }),
    );

    await page.route(`**/api/admin/subscriptions/${ACTIVE_ID}`, async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ACTIVE_FIXTURE),
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

  test('renders all fields for an active subscription', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${ACTIVE_ID}`);
    await expect(page.getByTestId('admin-subscription-detail')).toBeVisible();
    await expect(page.getByTestId('subscription-customer-email')).toHaveText('active@example.com');
    await expect(page.getByTestId('subscription-source-brand')).toHaveText('phonepilot');
    await expect(page.getByTestId('subscription-state-badge')).toHaveText('active');
    await expect(page.getByTestId('subscription-accounts-count')).toHaveText('2 / 5');
    await expect(page.getByTestId('subscription-required-count')).toHaveText('5');
    await expect(page.getByTestId('subscription-activated-by')).toHaveText('adm_1');
    await expect(page.getByTestId('subscription-next-renewal')).not.toHaveText('—');
    await expect(page.getByTestId('subscription-sku-metadata')).toContainText('account_count');
  });

  test('assignments list shows username, status, warmup_days', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${ACTIVE_ID}`);
    const rows = page.getByTestId('assignment-row');
    await expect(rows).toHaveCount(2);
    const first = rows.first();
    await expect(first.getByTestId('assignment-username')).toHaveText('ig_user_1');
    await expect(first.getByTestId('assignment-status')).toHaveText('active');
    await expect(first.getByTestId('assignment-warmup-days')).toHaveText('7');
  });

  test('pre-activation mode shows allocate section + activate button (post-activation hidden)', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${PENDING_ID}`);
    await expect(page.getByTestId('subscription-allocate-section')).toBeVisible();
    await expect(page.getByTestId('subscription-activate-button')).toBeVisible();
    await expect(page.getByTestId('subscription-manage-section')).toHaveCount(0);
    await expect(page.getByTestId('subscription-activate-button')).toBeDisabled();
    await expect(page.getByTestId('subscription-assignments-empty')).toBeVisible();
  });

  test('post-activation mode shows manage section (allocate section hidden)', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${ACTIVE_ID}`);
    await expect(page.getByTestId('subscription-manage-section')).toBeVisible();
    await expect(page.getByTestId('subscription-add-account-button')).toBeVisible();
    await expect(page.getByTestId('subscription-detach-account-button')).toBeVisible();
    await expect(page.getByTestId('subscription-allocate-section')).toHaveCount(0);
  });


  test('404 from backend renders subscription-not-found message', async ({ page }) => {
    const MISSING = '99999999-9999-9999-9999-999999999999';
    await page.unroute('**/api/admin/subscriptions*');
    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );
    await page.route(`**/api/admin/subscriptions/${MISSING}`, async (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'subscription not found' }),
    );
    await page.goto(`${UI_BASE}/admin/subscriptions/${MISSING}`);
    await expect(page.getByTestId('subscription-detail-error')).toContainText('not found');
  });
});
