import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4455';

async function publish(
  page: Page,
  customer: string,
  channel: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const resp = await page.request.post(`${BASE}/publish`, {
    data: { customer, channel, payload },
  });
  expect(resp.status()).toBe(204);
}

async function waitForOpen(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__state?.opens >= 1, null, {
    timeout: 5000,
  });
}

async function getState(page: Page): Promise<{
  accounts: Record<string, { id: string; status: string }>;
  balance_cents: number | null;
  batches: Record<string, Record<string, unknown>>;
  transport: string;
  errors: number;
  opens: number;
}> {
  return page.evaluate(() => (window as any).__state);
}

test.describe('realtime two-session E2E', () => {
  test('event to customer A delivers only to A (isolation + delivery)', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${BASE}/harness.html?customer=A`);
    await pageB.goto(`${BASE}/harness.html?customer=B`);
    await waitForOpen(pageA);
    await waitForOpen(pageB);

    await publish(pageA, 'A', 'account_state_changed', {
      customer_id: 'A',
      account_id: 'acct-1',
      status: 'active',
    });

    await pageA.waitForFunction(
      () => (window as any).__state?.accounts?.['acct-1']?.status === 'active',
      null,
      { timeout: 2000 },
    );

    const stA = await getState(pageA);
    const stB = await getState(pageB);

    expect(stA.accounts['acct-1']).toEqual({ id: 'acct-1', status: 'active' });
    expect(stB.accounts).toEqual({});

    await publish(pageA, 'B', 'balance_changed', { customer_id: 'B', balance_cents: 9999 });
    await pageB.waitForFunction(
      () => (window as any).__state?.balance_cents === 9999,
      null,
      { timeout: 2000 },
    );
    const stA2 = await getState(pageA);
    expect(stA2.balance_cents).toBeNull();

    await ctxA.close();
    await ctxB.close();
  });

  test('reconnect succeeds after 1s server drop', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/harness.html?customer=A`);
    await waitForOpen(page);

    const resp = await page.request.post(`${BASE}/drop-all`);
    expect(resp.status()).toBe(204);

    await page.waitForFunction(() => (window as any).__state?.errors >= 1, null, {
      timeout: 3000,
    });

    await page.waitForFunction(() => (window as any).__state?.opens >= 2, null, {
      timeout: 5000,
    });

    const reconnectStart = Date.now();
    await publish(page, 'A', 'account_state_changed', {
      customer_id: 'A',
      account_id: 'acct-reco',
      status: 'ready',
    });
    await page.waitForFunction(
      () => (window as any).__state?.accounts?.['acct-reco']?.status === 'ready',
      null,
      { timeout: 2000 },
    );
    const elapsed = Date.now() - reconnectStart;
    expect(elapsed).toBeLessThan(2000);

    await ctx.close();
  });
});
