<script lang="ts">
  import { onMount } from 'svelte';
  import AdminGuard from '../components/AdminGuard.svelte';
  import {
    adminClient,
    type AdminRevenueBrand,
    type AdminRevenueTimeframeDays,
  } from '../lib/api';

  const TIMEFRAMES: AdminRevenueTimeframeDays[] = [7, 30, 90];

  let brands: AdminRevenueBrand[] = [];
  let timeframe: AdminRevenueTimeframeDays = 30;
  let loading = true;
  let loadError = '';

  function readQuery(): void {
    const sp = new URLSearchParams(window.location.search);
    const raw = Number(sp.get('timeframe_days'));
    if ((TIMEFRAMES as number[]).includes(raw)) {
      timeframe = raw as AdminRevenueTimeframeDays;
    }
  }

  function writeQuery(): void {
    const sp = new URLSearchParams();
    if (timeframe !== 30) sp.set('timeframe_days', String(timeframe));
    const qs = sp.toString();
    const path = '/admin/revenue' + (qs ? `?${qs}` : '');
    if (path !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', path);
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await adminClient.getRevenue({ timeframe_days: timeframe });
      brands = res.brands;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load revenue';
    } finally {
      loading = false;
    }
  }

  function onTimeframeChange(): void {
    writeQuery();
    void load();
  }

  onMount(() => {
    readQuery();
    void load();
  });

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-revenue">
    <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 class="text-2xl font-semibold text-slate-900">Revenue</h1>
        <p class="text-sm text-slate-500">Per-brand customers, MRR, and recent revenue.</p>
      </div>
      <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Timeframe
        <select
          bind:value={timeframe}
          on:change={onTimeframeChange}
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          data-testid="revenue-timeframe"
        >
          {#each TIMEFRAMES as days}
            <option value={days}>Last {days} days</option>
          {/each}
        </select>
      </label>
    </header>

    {#if loading}
      <p class="text-sm text-slate-500" data-testid="revenue-loading">Loading…</p>
    {:else if loadError}
      <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </p>
    {:else if brands.length === 0}
      <p class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500" data-testid="revenue-empty">
        No brand activity yet.
      </p>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="revenue-cards">
        {#each brands as b (b.brand_code)}
          <article
            class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            data-testid="revenue-card"
            data-brand-code={b.brand_code}
          >
            <h2 class="text-lg font-semibold text-slate-900" data-testid="card-brand">{b.brand_code}</h2>
            <dl class="mt-3 grid grid-cols-2 gap-y-2 text-sm">
              <dt class="text-slate-500">Customers</dt>
              <dd class="text-right font-medium text-slate-900" data-testid="card-customers">
                {b.total_customers}
              </dd>
              <dt class="text-slate-500">Active orders</dt>
              <dd class="text-right font-medium text-slate-900" data-testid="card-active-orders">
                {b.active_orders}
              </dd>
              <dt class="text-slate-500">Active subs</dt>
              <dd class="text-right font-medium text-slate-900" data-testid="card-active-subscriptions">
                {b.active_subscriptions}
              </dd>
              <dt class="text-slate-500">MRR</dt>
              <dd class="text-right font-medium text-slate-900" data-testid="card-mrr">
                {dollars(b.mrr_cents)}
              </dd>
              <dt class="text-slate-500">Revenue ({timeframe}d)</dt>
              <dd class="text-right font-medium text-slate-900" data-testid="card-revenue">
                {dollars(b.revenue_cents)}
              </dd>
            </dl>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</AdminGuard>
