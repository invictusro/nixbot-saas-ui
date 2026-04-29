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

interface Offering {
  id: string;
  sku_id: string;
  brand_code: string;
  price_cents: number;
  stripe_price_id: string;
  active: boolean;
  created_at: string;
}

interface SkuRow {
  id: string;
  product_id: string;
  code: string;
  billing_type: 'one_shot' | 'recurring_monthly';
  recurring_interval_months: number | null;
  metadata_json: Record<string, unknown>;
  active: boolean;
  created_at: string;
  offerings: Offering[];
}

function makeFixture(): SkuRow[] {
  return [
    {
      id: '00000000-0000-4000-a000-000000000001',
      product_id: 'prod-byo',
      code: 'reels_10pack',
      billing_type: 'one_shot',
      recurring_interval_months: null,
      metadata_json: {},
      active: true,
      created_at: '2026-04-01T00:00:00Z',
      offerings: [
        {
          id: 'off-reels-nix',
          sku_id: '00000000-0000-4000-a000-000000000001',
          brand_code: 'nixbot',
          price_cents: 1900,
          stripe_price_id: '',
          active: true,
          created_at: '2026-04-01T00:00:00Z',
        },
      ],
    },
    {
      id: '00000000-0000-4000-a000-000000000002',
      product_id: 'prod-managed',
      code: 'managed_3acc_1mo',
      billing_type: 'recurring_monthly',
      recurring_interval_months: 1,
      metadata_json: {},
      active: true,
      created_at: '2026-04-01T00:00:00Z',
      offerings: [
        {
          id: 'off-mgd-nix',
          sku_id: '00000000-0000-4000-a000-000000000002',
          brand_code: 'nixbot',
          price_cents: 9900,
          stripe_price_id: '',
          active: true,
          created_at: '2026-04-01T00:00:00Z',
        },
        {
          id: 'off-mgd-pp',
          sku_id: '00000000-0000-4000-a000-000000000002',
          brand_code: 'phonepilot',
          price_cents: 12900,
          stripe_price_id: '',
          active: true,
          created_at: '2026-04-01T00:00:00Z',
        },
      ],
    },
  ];
}

interface MockState {
  fixture: SkuRow[];
  patchCalls: { id: string; body: any }[];
  postCalls: { body: any }[];
}

async function mockAdminRoutes(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/auth/refresh', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: ADMIN_TOKEN, token_type: 'Bearer' }),
    }),
  );

  await page.route('**/api/admin/skus*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: state.fixture,
        limit: 200,
        offset: 0,
        total: state.fixture.length,
      }),
    });
  });

  await page.route('**/api/admin/sku-offerings', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    state.postCalls.push({ body });
    const newOffering: Offering = {
      id: `off-new-${body.sku_id}-${body.brand_code}`,
      sku_id: body.sku_id,
      brand_code: body.brand_code,
      price_cents: body.price_cents,
      stripe_price_id: body.stripe_price_id ?? '',
      active: true,
      created_at: '2026-04-28T00:00:00Z',
    };
    const idx = state.fixture.findIndex((s) => s.id === body.sku_id);
    if (idx >= 0) state.fixture[idx].offerings.push(newOffering);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(newOffering),
    });
  });

  await page.route('**/api/admin/sku-offerings/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const body = route.request().postDataJSON();
    state.patchCalls.push({ id, body });
    let updated: Offering | null = null;
    for (const sku of state.fixture) {
      for (const o of sku.offerings) {
        if (o.id === id) {
          if (typeof body.price_cents === 'number') o.price_cents = body.price_cents;
          if (typeof body.active === 'boolean') o.active = body.active;
          updated = o;
        }
      }
    }
    await route.fulfill({
      status: updated ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(updated ?? { error: 'not found' }),
    });
  });
}

test.describe('admin-catalog: SKU × brand price grid', () => {
  test.skip(!RUN_UI_E2E, SKIP_REASON);

  test('renders one row per SKU and one column per brand with offered + empty cells', async ({ page }) => {
    const state: MockState = { fixture: makeFixture(), patchCalls: [], postCalls: [] };
    await mockAdminRoutes(page, state);
    await page.goto(`${UI_BASE}/admin/catalog`);

    await expect(page.getByTestId('catalog-table')).toBeVisible();
    await expect(page.getByTestId('catalog-row')).toHaveCount(2);
    await expect(page.getByTestId('catalog-brand-header')).toHaveCount(2);

    const reelsRow = page.locator('[data-testid="catalog-row"][data-sku-id="00000000-0000-4000-a000-000000000001"]');
    await expect(reelsRow.locator('[data-brand-code="nixbot"]')).toContainText('$19.00');
    // phonepilot has no offering for reels — should render an empty cell (—).
    const reelsPP = reelsRow.locator('[data-brand-code="phonepilot"]');
    await expect(reelsPP).toHaveAttribute('data-state', 'empty');
    await expect(reelsPP).toContainText('—');
  });

  test('clicking an empty cell creates a new offering via POST and updates the table', async ({ page }) => {
    const state: MockState = { fixture: makeFixture(), patchCalls: [], postCalls: [] };
    await mockAdminRoutes(page, state);
    await page.goto(`${UI_BASE}/admin/catalog`);

    const reelsRow = page.locator('[data-testid="catalog-row"][data-sku-id="00000000-0000-4000-a000-000000000001"]');
    const reelsPP = reelsRow.locator('[data-brand-code="phonepilot"]');
    await reelsPP.getByTestId('catalog-cell-button').click();
    await reelsPP.getByTestId('catalog-editor-input').fill('24.50');
    await reelsPP.getByTestId('catalog-editor-save').click();

    await expect.poll(() => state.postCalls.length).toBe(1);
    expect(state.postCalls[0].body).toMatchObject({
      sku_id: '00000000-0000-4000-a000-000000000001',
      brand_code: 'phonepilot',
      price_cents: 2450,
    });
    await expect(reelsPP).toHaveAttribute('data-state', 'offered');
    await expect(reelsPP).toContainText('$24.50');
  });

  test('clicking an existing cell updates the offering price via PATCH (with confirmation)', async ({ page }) => {
    const state: MockState = { fixture: makeFixture(), patchCalls: [], postCalls: [] };
    await mockAdminRoutes(page, state);
    page.on('dialog', (d) => d.accept());

    await page.goto(`${UI_BASE}/admin/catalog`);

    const mgdRow = page.locator('[data-testid="catalog-row"][data-sku-id="00000000-0000-4000-a000-000000000002"]');
    const mgdNix = mgdRow.locator('[data-brand-code="nixbot"]');
    await mgdNix.getByTestId('catalog-cell-button').click();
    const input = mgdNix.getByTestId('catalog-editor-input');
    await input.fill('109.00');
    await mgdNix.getByTestId('catalog-editor-save').click();

    await expect.poll(() => state.patchCalls.length).toBe(1);
    expect(state.patchCalls[0]).toMatchObject({
      id: 'off-mgd-nix',
      body: { price_cents: 10900 },
    });
    await expect(mgdNix).toContainText('$109.00');
  });

  test('rejects invalid price input without making a network call', async ({ page }) => {
    const state: MockState = { fixture: makeFixture(), patchCalls: [], postCalls: [] };
    await mockAdminRoutes(page, state);
    await page.goto(`${UI_BASE}/admin/catalog`);

    const mgdRow = page.locator('[data-testid="catalog-row"][data-sku-id="00000000-0000-4000-a000-000000000002"]');
    const mgdNix = mgdRow.locator('[data-brand-code="nixbot"]');
    await mgdNix.getByTestId('catalog-cell-button').click();
    await mgdNix.getByTestId('catalog-editor-input').fill('not-a-number');
    await mgdNix.getByTestId('catalog-editor-save').click();

    await expect(mgdNix.getByTestId('catalog-editor-error')).toBeVisible();
    expect(state.patchCalls.length).toBe(0);
    expect(state.postCalls.length).toBe(0);
  });
});
