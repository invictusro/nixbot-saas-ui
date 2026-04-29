<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import {
    adminClient,
    type AdminOrderRow,
    type AdminOrderState,
    type AdminOrdersListOpts,
  } from '../lib/api';
  import { getAllBrandCodes } from '../lib/brand';

  const BRAND_CODES = getAllBrandCodes();

  const STATES: AdminOrderState[] = [
    'pending',
    'active',
    'paused',
    'completed',
    'cancelled',
    'refunded',
  ];

  let rows: AdminOrderRow[] = [];
  let nextOffset: number | null = null;
  let loading = true;
  let loadingMore = false;
  let loadError = '';

  let stateFilter: AdminOrderState | '' = '';
  let sourceBrand = '';
  let sortBy: 'created_at' | 'state' = 'created_at';
  let sortDir: 'asc' | 'desc' = 'desc';

  let toast = '';

  const PAGE = 50;

  function readQuery(): void {
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get('state');
    stateFilter = (s && (STATES as string[]).includes(s) ? s : '') as AdminOrderState | '';
    const brand = sp.get('source_brand') ?? '';
    sourceBrand = BRAND_CODES.includes(brand) ? brand : '';
    const sb = sp.get('sort_by');
    sortBy = sb === 'state' ? 'state' : 'created_at';
    const sd = sp.get('sort_dir');
    sortDir = sd === 'asc' ? 'asc' : 'desc';
  }

  function writeQuery(): void {
    const sp = new URLSearchParams();
    if (stateFilter) sp.set('state', stateFilter);
    if (sourceBrand) sp.set('source_brand', sourceBrand);
    if (sortBy !== 'created_at') sp.set('sort_by', sortBy);
    if (sortDir !== 'desc') sp.set('sort_dir', sortDir);
    const qs = sp.toString();
    const path = '/admin/orders' + (qs ? `?${qs}` : '');
    if (path !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', path);
    }
  }

  function buildOpts(offset = 0): AdminOrdersListOpts {
    const opts: AdminOrdersListOpts = { limit: PAGE, offset, sort_by: sortBy, sort_dir: sortDir };
    if (stateFilter) opts.state = stateFilter;
    if (sourceBrand) opts.source_brand = sourceBrand;
    return opts;
  }

  async function load(reset = false): Promise<void> {
    if (reset) {
      loading = true;
      rows = [];
      nextOffset = null;
    } else {
      loadingMore = true;
    }
    loadError = '';
    try {
      const offset = reset ? 0 : nextOffset ?? 0;
      const page = await adminClient.listOrders(buildOpts(offset));
      rows = reset ? page.orders : [...rows, ...page.orders];
      nextOffset = page.next_offset ?? null;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load orders';
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  function applyFilters(): void {
    writeQuery();
    void load(true);
  }

  function rowKeydown(e: KeyboardEvent, id: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/admin/orders/${encodeURIComponent(id)}`);
    }
  }

  function fmtDate(s: string): string {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 16).replace('T', ' ');
  }

  onMount(() => {
    readQuery();
    const t = sessionStorage.getItem('admin-orders-toast');
    if (t) {
      sessionStorage.removeItem('admin-orders-toast');
      toast = t;
      setTimeout(() => {
        if (toast === t) toast = '';
      }, 4000);
    }
    void load(true);
  });
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-orders">
    <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 class="text-2xl font-semibold text-slate-900">Orders</h1>
        <p class="text-sm text-slate-500">All Service B orders across brands.</p>
      </div>
      <form
        class="flex flex-wrap items-end gap-3"
        on:submit|preventDefault={applyFilters}
        data-testid="admin-orders-filters"
      >
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          State
          <select
            bind:value={stateFilter}
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            data-testid="filter-state"
          >
            <option value="">Any</option>
            {#each STATES as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Source brand
          <select
            bind:value={sourceBrand}
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            data-testid="filter-source-brand"
          >
            <option value="">All brands</option>
            {#each BRAND_CODES as code}
              <option value={code}>{code}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Sort by
          <select
            bind:value={sortBy}
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            data-testid="sort-by"
          >
            <option value="created_at">Created</option>
            <option value="state">State</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Direction
          <select
            bind:value={sortDir}
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            data-testid="sort-dir"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </label>
        <button
          type="submit"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          data-testid="apply-filters"
        >
          Apply
        </button>
      </form>
    </header>

    {#if toast}
      <p
        role="status"
        data-testid="admin-orders-toast"
        class="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
      >
        {toast}
      </p>
    {/if}

    {#if loading}
      <p class="text-sm text-slate-500" data-testid="admin-orders-loading">Loading…</p>
    {:else if loadError}
      <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </p>
    {:else if rows.length === 0}
      <p
        class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500"
        data-testid="admin-orders-empty"
      >
        No orders match these filters.
      </p>
    {:else}
      <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table class="min-w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Created</th>
              <th class="px-4 py-3">Customer</th>
              <th class="px-4 py-3">Brand</th>
              <th class="px-4 py-3">SKU</th>
              <th class="px-4 py-3">State</th>
              <th class="px-4 py-3">Progress</th>
              <th class="px-4 py-3">Started by</th>
              <th class="px-4 py-3" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each rows as row (row.id)}
              <tr
                role="link"
                tabindex="0"
                class="cursor-pointer hover:bg-slate-50"
                on:click={() => navigate(`/admin/orders/${encodeURIComponent(row.id)}`)}
                on:keydown={(e) => rowKeydown(e, row.id)}
                data-testid="admin-order-row"
                data-state={row.state}
              >
                <td class="px-4 py-3 text-slate-700">{fmtDate(row.created_at)}</td>
                <td class="px-4 py-3 font-mono text-slate-900">{row.customer_email}</td>
                <td class="px-4 py-3 text-slate-700">{row.source_brand}</td>
                <td class="px-4 py-3 text-slate-700">{row.sku_code}</td>
                <td class="px-4 py-3 text-slate-700" data-testid="row-state">{row.state}</td>
                <td class="px-4 py-3 text-slate-700">{row.posts_done}/{row.posts_total}</td>
                <td class="px-4 py-3 font-mono text-xs text-slate-500">
                  {row.started_by ?? '—'}
                </td>
                <td class="px-4 py-3 text-right">
                  <Link
                    to={`/admin/orders/${encodeURIComponent(row.id)}`}
                    getProps={() => ({
                      class: 'text-slate-900 underline hover:text-slate-700',
                      'data-testid': 'admin-order-link',
                    })}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if nextOffset !== null}
        <div class="text-center">
          <button
            type="button"
            on:click={() => void load(false)}
            disabled={loadingMore}
            class="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            data-testid="load-more"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      {/if}
    {/if}
  </section>
</AdminGuard>
