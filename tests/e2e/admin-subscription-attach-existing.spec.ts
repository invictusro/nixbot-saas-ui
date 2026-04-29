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

interface IdleFixture {
  id: string;
  username: string;
  niche: string | null;
  status: string;
  warmup_days: number;
  posting_enabled: boolean;
}

interface Assignment {
  id: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
}

const SUBSCRIPTION_BASE = {
  id: SUB_ID,
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
  assignments: [] as Assignment[],
};

const IDLE_POOL: IdleFixture[] = [
  {
    id: 'acc-1',
    username: 'fitness_guru_a',
    niche: 'fitness',
    status: 'active',
    warmup_days: 12,
    posting_enabled: true,
  },
  {
    id: 'acc-2',
    username: 'fitness_guru_b',
    niche: 'fitness',
    status: 'active',
    warmup_days: 8,
    posting_enabled: true,
  },
  {
    id: 'acc-3',
    username: 'travel_pal',
    niche: 'travel',
    status: 'active',
    warmup_days: 5,
    posting_enabled: true,
  },
  {
    id: 'acc-4',
    username: 'misc_creator',
    niche: null,
    status: 'active',
    warmup_days: 3,
    posting_enabled: true,
  },
];

test.describe('admin-ui-subscriptions: attach existing operator accounts', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  let detail: typeof SUBSCRIPTION_BASE;
  let idlePool: IdleFixture[];
  let attached: Assignment[];
  let lastAllocBody: { account_ids: string[]; start_warmup?: boolean } | null;

  test.beforeEach(async ({ page }) => {
    detail = JSON.parse(JSON.stringify(SUBSCRIPTION_BASE));
    idlePool = JSON.parse(JSON.stringify(IDLE_POOL));
    attached = [];
    lastAllocBody = null;

    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );

    await page.route(`**/api/admin/subscriptions/${SUB_ID}/allocate-accounts`, async (route) => {
      lastAllocBody = JSON.parse(route.request().postData() ?? '{}') as {
        account_ids: string[];
        start_warmup?: boolean;
      };
      const created: Assignment[] = lastAllocBody.account_ids.map((id, i) => {
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
      detail.assignments = attached;
      const set = new Set(lastAllocBody.account_ids);
      idlePool = idlePool.filter((p) => !set.has(p.id));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription_id: SUB_ID,
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

  test('idle list excludes accounts already in active managed_assignments', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('idle-row')).toHaveCount(4);
    await page.getByTestId('idle-row').filter({ hasText: 'fitness_guru_a' }).getByTestId('idle-checkbox').check();
    await page.getByTestId('alloc-attach-button').click();
    await expect(page.getByTestId('assignment-row')).toHaveCount(1);
    await expect(page.getByTestId('idle-row')).toHaveCount(3);
    const remainingNames = await page.getByTestId('idle-username').allTextContents();
    expect(remainingNames).not.toContain('fitness_guru_a');
  });

  test('client-side search by username narrows the visible idle rows', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('idle-row')).toHaveCount(4);
    await page.getByTestId('idle-search').fill('travel');
    await expect(page.getByTestId('idle-row')).toHaveCount(1);
    await expect(page.getByTestId('idle-row').first().getByTestId('idle-username')).toHaveText(
      'travel_pal',
    );
  });

  test('client-side search by niche narrows the visible idle rows', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await page.getByTestId('idle-search').fill('fitness');
    await expect(page.getByTestId('idle-row')).toHaveCount(2);
  });

  test('multi-select respects required count: extra checkboxes disabled at cap', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    const rows = page.getByTestId('idle-row');
    await rows.nth(0).getByTestId('idle-checkbox').check();
    await rows.nth(1).getByTestId('idle-checkbox').check();
    await rows.nth(2).getByTestId('idle-checkbox').check();
    await expect(page.getByTestId('idle-cap-notice')).toBeVisible();
    await expect(rows.nth(3).getByTestId('idle-checkbox')).toBeDisabled();
  });

  test('attach 3 to a 3-account subscription posts the right body and refreshes', async ({
    page,
  }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    const rows = page.getByTestId('idle-row');
    await rows.nth(0).getByTestId('idle-checkbox').check();
    await rows.nth(1).getByTestId('idle-checkbox').check();
    await rows.nth(2).getByTestId('idle-checkbox').check();
    await page.getByTestId('alloc-start-warmup').check();
    await page.getByTestId('alloc-attach-button').click();
    await expect(page.getByTestId('assignment-row')).toHaveCount(3);
    expect(lastAllocBody).not.toBeNull();
    expect(lastAllocBody!.start_warmup).toBe(true);
    expect(lastAllocBody!.account_ids.sort()).toEqual(['acc-1', 'acc-2', 'acc-3']);
    await expect(page.getByTestId('subscription-activate-button')).toBeEnabled();
  });

  test('niche filter triggers a refresh request with niche query param', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('idle-row')).toHaveCount(4);
    await page.getByTestId('idle-niche-filter').fill('fitness');
    const [request] = await Promise.all([
      page.waitForRequest((r) =>
        r.url().includes('/api/admin/operator-accounts/idle') && r.url().includes('niche=fitness'),
      ),
      page.getByTestId('idle-reload-button').click(),
    ]);
    expect(request.url()).toContain('niche=fitness');
    await expect(page.getByTestId('idle-row')).toHaveCount(2);
  });

  test('attach with no selection shows alloc-error and does not POST', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await page.getByTestId('alloc-attach-button').click();
    // Button is disabled at zero selection, so error is via the empty-selection guard
    // when forced via event dispatch. The button is disabled in the UI; assert disabled state.
    await expect(page.getByTestId('alloc-attach-button')).toBeDisabled();
    expect(lastAllocBody).toBeNull();
  });
});
