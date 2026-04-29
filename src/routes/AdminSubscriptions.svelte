<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import {
    adminClient,
    type AdminSubscriptionRow,
    type AdminSubscriptionState,
    type AdminSubscriptionsListOpts,
  } from '../lib/api';
  import { getAllBrandCodes } from '../lib/brand';

  const BRAND_CODES = getAllBrandCodes();

  const STATES: AdminSubscriptionState[] = [
    'pending_activation',
    'active',
    'paused',
    'pending_cancellation',
    'cancelled',
    'expired',
  ];

  let rows: AdminSubscriptionRow[] = [];
  let nextOffset: number | null = null;
  let loading = true;
  let loadingMore = false;
  let loadError = '';

  let stateFilter: AdminSubscriptionState | '' = '';
  let sourceBrand = '';
  let sortBy: 'created_at' | 'next_renewal_at' | 'state' = 'created_at';
  let sortDir: 'asc' | 'desc' = 'desc';

  let toast = '';

  const PAGE = 50;

  function readQuery(): void {
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get('state');
    stateFilter = (s && (STATES as string[]).includes(s) ? s : '') as AdminSubscriptionState | '';
    const brand = sp.get('source_brand') ?? '';
    sourceBrand = BRAND_CODES.includes(brand) ? brand : '';
    const sb = sp.get('sort_by');
    sortBy = sb === 'next_renewal_at' || sb === 'state' ? sb : 'created_at';
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
    const path = '/admin/subscriptions' + (qs ? `?${qs}` : '');
    if (path !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', path);
    }
  }

  function buildOpts(offset = 0): AdminSubscriptionsListOpts {
    const opts: AdminSubscriptionsListOpts = {
      limit: PAGE,
      offset,
      sort_by: sortBy,
      sort_dir: sortDir,
    };
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
      const page = await adminClient.listSubscriptions(buildOpts(offset));
      rows = reset ? page.subscriptions : [...rows, ...page.subscriptions];
      nextOffset = page.next_offset ?? null;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load subscriptions';
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
      navigate(`/admin/subscriptions/${encodeURIComponent(id)}`);
    }
  }

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function badgeClass(state: AdminSubscriptionState): string {
    if (state === 'pending_activation') {
      return 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300';
    }
    if (state === 'active') {
      return 'inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800';
    }
    if (state === 'paused' || state === 'pending_cancellation') {
      return 'inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700';
    }
    return 'inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500';
  }

  function rowClass(state: AdminSubscriptionState): string {
    const base = 'cursor-pointer hover:bg-slate-50';
    return state === 'pending_activation' ? `${base} bg-amber-50` : base;
  }

  function assignmentsClass(row: AdminSubscriptionRow): string {
    if (row.required_account_count == null) return 'text-slate-700';
    return row.active_assignments < row.required_account_count
      ? 'text-amber-700 font-semibold'
      : 'text-slate-700';
  }

  onMount(() => {
    readQuery();
    const t = sessionStorage.getItem('admin-subscriptions-toast');
    if (t) {
      sessionStorage.removeItem('admin-subscriptions-toast');
      toast = t;
      setTimeout(() => {
        if (toast === t) toast = '';
      }, 4000);
    }
    void load(true);
  });
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-subscriptions">
    <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 class="text-2xl font-semibold text-slate-900">Subscriptions</h1>
        <p class="text-sm text-slate-500">All Service C subscriptions across brands.</p>
      </div>
      <form
        class="flex flex-wrap items-end gap-3"
        on:submit|preventDefault={applyFilters}
        data-testid="admin-subscriptions-filters"
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
            <option value="next_renewal_at">Next renewal</option>
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
        data-testid="admin-subscriptions-toast"
        class="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
      >
        {toast}
      </p>
    {/if}

    {#if loading}
      <p class="text-sm text-slate-500" data-testid="admin-subscriptions-loading">Loading…</p>
    {:else if loadError}
      <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </p>
    {:else if rows.length === 0}
      <p
        class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500"
        data-testid="admin-subscriptions-empty"
      >
        No subscriptions match these filters.
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
              <th class="px-4 py-3">Next renewal</th>
              <th class="px-4 py-3">Accounts</th>
              <th class="px-4 py-3" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each rows as row (row.id)}
              <tr
                role="link"
                tabindex="0"
                class={rowClass(row.state)}
                on:click={() => navigate(`/admin/subscriptions/${encodeURIComponent(row.id)}`)}
                on:keydown={(e) => rowKeydown(e, row.id)}
                data-testid="admin-subscription-row"
                data-state={row.state}
              >
                <td class="px-4 py-3 text-slate-700">{fmtDate(row.created_at)}</td>
                <td class="px-4 py-3 font-mono text-slate-900">{row.customer_email}</td>
                <td class="px-4 py-3 text-slate-700">{row.source_brand}</td>
                <td class="px-4 py-3 text-slate-700">{row.sku_code}</td>
                <td class="px-4 py-3">
                  <span class={badgeClass(row.state)} data-testid="row-state">{row.state}</span>
                </td>
                <td class="px-4 py-3 text-slate-700" data-testid="row-next-renewal">
                  {fmtDate(row.next_renewal_at)}
                </td>
                <td class="px-4 py-3" data-testid="row-assignments">
                  <span class={assignmentsClass(row)}>
                    {row.active_assignments}{row.required_account_count != null
                      ? ` / ${row.required_account_count}`
                      : ''}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <Link
                    to={`/admin/subscriptions/${encodeURIComponent(row.id)}`}
                    getProps={() => ({
                      class: 'text-slate-900 underline hover:text-slate-700',
                      'data-testid': 'admin-subscription-link',
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
