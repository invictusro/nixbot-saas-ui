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

const SUB_ID = '44444444-4444-4444-4444-444444444444';

interface Assignment {
  id: string;
  account_id: string;
  username: string;
  status: string;
  warmup_days: number;
  started_at: string;
  pending_creation: boolean;
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

test.describe('admin subscription detail — create & attach new accounts', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem('rabot_access_token', token);
      window.localStorage.setItem('rabot_user', JSON.stringify({ id: 'adm_1', is_admin: true }));
    }, ADMIN_TOKEN);
  });

  test('Create N enqueues N jobs and renders placeholders as being created', async ({ page }) => {
    const sub = JSON.parse(JSON.stringify(SUBSCRIPTION_BASE));
    let placeholderCounter = 0;
    let createCalls = 0;

    await page.route(`**/api/admin/subscriptions/${SUB_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sub),
      });
    });

    await page.route(`**/api/admin/subscriptions/${SUB_ID}/create-accounts`, async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as { count: number };
      createCalls++;
      const placeholders: Assignment[] = [];
      for (let i = 0; i < payload.count; i++) {
        placeholderCounter++;
        const a: Assignment = {
          id: `placeholder-${placeholderCounter}`,
          account_id: '',
          username: '',
          status: '',
          warmup_days: 0,
          started_at: '2026-04-27T00:00:00Z',
          pending_creation: true,
        };
        sub.assignments.push(a);
        placeholders.push(a);
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription_id: SUB_ID,
          assignments: placeholders.map((p) => ({ id: p.id, pending_creation: true })),
          jobs_enqueued: payload.count,
        }),
      });
    });

    await page.route('**/api/admin/operator-accounts/idle*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [] }),
      });
    });

    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('subscription-create-section')).toBeVisible();

    await page.getByTestId('create-count-input').fill('3');
    await page.getByTestId('create-accounts-button').click();

    await expect(page.getByTestId('subscription-accounts-count')).toContainText('0 / 3');
    const rows = page.locator('[data-testid="assignment-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('data-pending', 'true');
    await expect(page.getByTestId('assignment-username').first()).toHaveText('Being created…');
    await expect(page.getByTestId('assignment-status').first()).toHaveText('pending');

    expect(createCalls).toBe(1);

    // Activate must remain disabled while placeholders exist (no real accounts yet).
    await expect(page.getByTestId('subscription-activate-button')).toBeDisabled();
  });

  test('Successful creation finalizes placeholder into real assignment', async ({ page }) => {
    const sub = JSON.parse(JSON.stringify(SUBSCRIPTION_BASE));
    sub.assignments = [
      {
        id: 'placeholder-1',
        account_id: '',
        username: '',
        status: '',
        warmup_days: 0,
        started_at: '2026-04-27T00:00:00Z',
        pending_creation: true,
      },
    ];

    let detailCalls = 0;
    await page.route(`**/api/admin/subscriptions/${SUB_ID}`, (route) => {
      detailCalls++;
      // Second call simulates the operator finalizing the placeholder:
      // pending_creation flips false, account_id + username populated.
      if (detailCalls >= 2) {
        sub.assignments = [
          {
            id: 'placeholder-1',
            account_id: 'real-acc-1',
            username: 'auto_made_a',
            status: 'ready',
            warmup_days: 0,
            started_at: '2026-04-27T00:00:00Z',
            pending_creation: false,
          },
        ];
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sub),
      });
    });

    await page.route('**/api/admin/operator-accounts/idle*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [] }),
      });
    });

    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    await expect(page.getByTestId('assignment-username').first()).toHaveText('Being created…');

    // Trigger another load by clicking refresh idle list (it calls load() too via shared layout
    // patterns) — alternatively use a direct nav reload.
    await page.reload();

    const row = page.locator('[data-testid="assignment-row"]').first();
    await expect(row).toHaveAttribute('data-pending', 'false');
    await expect(page.getByTestId('assignment-username').first()).toHaveText('auto_made_a');
    await expect(row).toHaveAttribute('data-account-id', 'real-acc-1');
  });

  test('Empty count input shows error and does not POST', async ({ page }) => {
    let createCalls = 0;
    await page.route(`**/api/admin/subscriptions/${SUB_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SUBSCRIPTION_BASE),
      });
    });
    await page.route(`**/api/admin/subscriptions/${SUB_ID}/create-accounts`, (route) => {
      createCalls++;
      route.fulfill({ status: 500, body: '' });
    });
    await page.route('**/api/admin/operator-accounts/idle*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [] }),
      });
    });
    await page.goto(`${UI_BASE}/admin/subscriptions/${SUB_ID}`);
    // Button is disabled with empty/zero count — no POST should fire.
    await expect(page.getByTestId('create-accounts-button')).toBeDisabled();
    expect(createCalls).toBe(0);
  });
});
