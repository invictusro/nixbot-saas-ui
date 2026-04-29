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

interface SubRow {
  id: string;
  created_at: string;
  customer_email: string;
  source_brand: string;
  sku_code: string;
  state: string;
  next_renewal_at?: string | null;
  active_assignments: number;
  required_account_count?: number | null;
}

const FIXTURE: SubRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-04-26T10:00:00Z',
    customer_email: 'pending1@example.com',
    source_brand: 'nixbot',
    sku_code: 'managed-3',
    state: 'pending_activation',
    next_renewal_at: null,
    active_assignments: 0,
    required_account_count: 3,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    created_at: '2026-04-26T11:00:00Z',
    customer_email: 'active1@example.com',
    source_brand: 'phonepilot',
    sku_code: 'managed-5',
    state: 'active',
    next_renewal_at: '2026-05-26T11:00:00Z',
    active_assignments: 5,
    required_account_count: 5,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    created_at: '2026-04-26T12:00:00Z',
    customer_email: 'pending2@example.com',
    source_brand: 'nixbot',
    sku_code: 'managed-3',
    state: 'pending_activation',
    next_renewal_at: null,
    active_assignments: 1,
    required_account_count: 3,
  },
];

function sortRows(rows: SubRow[], sortBy: string, sortDir: string): SubRow[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    const av =
      sortBy === 'next_renewal_at' ? a.next_renewal_at ?? '' : sortBy === 'state' ? a.state : a.created_at;
    const bv =
      sortBy === 'next_renewal_at' ? b.next_renewal_at ?? '' : sortBy === 'state' ? b.state : b.created_at;
    if (av === bv) return 0;
    return av < bv ? -dir : dir;
  });
  return sorted;
}

test.describe('admin-ui-subscriptions: /admin/subscriptions list', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/refresh', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
      }),
    );
    await page.route('**/api/admin/subscriptions*', async (route) => {
      const url = new URL(route.request().url());
      const state = url.searchParams.get('state');
      const sourceBrand = url.searchParams.get('source_brand');
      const sortBy = url.searchParams.get('sort_by') ?? 'created_at';
      const sortDir = url.searchParams.get('sort_dir') ?? 'desc';
      let rows = FIXTURE.slice();
      if (state) rows = rows.filter((r) => r.state === state);
      if (sourceBrand) rows = rows.filter((r) => r.source_brand === sourceBrand);
      rows = sortRows(rows, sortBy, sortDir);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: rows }),
      });
    });
  });

  test('renders all rows with filter and sort controls', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    await expect(page.getByTestId('admin-subscriptions-filters')).toBeVisible();
    await expect(page.getByTestId('filter-state')).toBeVisible();
    await expect(page.getByTestId('filter-source-brand')).toBeVisible();
    await expect(page.getByTestId('sort-by')).toBeVisible();
    await expect(page.getByTestId('sort-dir')).toBeVisible();
    await expect(page.getByTestId('admin-subscription-row')).toHaveCount(3);
  });

  test('pending_activation rows are visually distinct', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    const pendingRows = page.locator('[data-testid="admin-subscription-row"][data-state="pending_activation"]');
    await expect(pendingRows).toHaveCount(2);
    const cls = await pendingRows.first().getAttribute('class');
    expect(cls ?? '').toMatch(/bg-amber-/);
  });

  test('filter by state=pending_activation shows only those rows and persists in URL', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    await expect(page.getByTestId('admin-subscription-row')).toHaveCount(3);
    await page.getByTestId('filter-state').selectOption('pending_activation');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('admin-subscription-row')).toHaveCount(2);
    for (const cell of await page.getByTestId('row-state').all()) {
      await expect(cell).toHaveText('pending_activation');
    }
    expect(page.url()).toMatch(/[?&]state=pending_activation\b/);
  });

  test('reads filters from URL on initial load', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions?state=pending_activation`);
    await expect(page.getByTestId('admin-subscription-row')).toHaveCount(2);
    await expect(page.getByTestId('filter-state')).toHaveValue('pending_activation');
  });

  test('sort by next_renewal_at hits backend with sort_by param', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    const reqWait = page.waitForRequest((req) =>
      req.url().includes('/api/admin/subscriptions') && req.url().includes('sort_by=next_renewal_at'),
    );
    await page.getByTestId('sort-by').selectOption('next_renewal_at');
    await page.getByTestId('sort-dir').selectOption('asc');
    await page.getByTestId('apply-filters').click();
    const req = await reqWait;
    const url = new URL(req.url());
    expect(url.searchParams.get('sort_by')).toBe('next_renewal_at');
    expect(url.searchParams.get('sort_dir')).toBe('asc');
    expect(page.url()).toMatch(/sort_by=next_renewal_at/);
    expect(page.url()).toMatch(/sort_dir=asc/);
  });

  test('clicking a row navigates to /admin/subscriptions/:id', async ({ page }) => {
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    const firstLink = page.getByTestId('admin-subscription-link').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/admin\/subscriptions\/[0-9a-f-]+$/);
  });

  test('empty state renders when no subscriptions match', async ({ page }) => {
    await page.unroute('**/api/admin/subscriptions*');
    await page.route('**/api/admin/subscriptions*', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscriptions: [] }),
      }),
    );
    await page.goto(`${UI_BASE}/admin/subscriptions`);
    await expect(page.getByTestId('admin-subscriptions-empty')).toBeVisible();
  });
});
