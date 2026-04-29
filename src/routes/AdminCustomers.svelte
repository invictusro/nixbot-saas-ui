<script lang="ts">
  import { onMount } from 'svelte';
  import { Link } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import { adminClient, type AdminCustomerRow } from '../lib/api';
  import { getAllBrandCodes } from '../lib/brand';

  const BRAND_CODES = getAllBrandCodes();

  let rows: AdminCustomerRow[] = [];
  let nextCursor: string | null | undefined = null;
  let query = '';
  let sourceBrand = '';
  let loading = true;
  let loadError = '';
  let loadingMore = false;

  function readQuery(): void {
    const sp = new URLSearchParams(window.location.search);
    query = sp.get('q') ?? '';
    const sb = sp.get('source_brand') ?? '';
    sourceBrand = BRAND_CODES.includes(sb) ? sb : '';
  }

  function writeQuery(): void {
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
    if (sourceBrand) sp.set('source_brand', sourceBrand);
    const qs = sp.toString();
    const path = '/admin/customers' + (qs ? `?${qs}` : '');
    if (path !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', path);
    }
  }

  async function load(reset = false): Promise<void> {
    if (reset) {
      loading = true;
      rows = [];
      nextCursor = null;
    } else {
      loadingMore = true;
    }
    loadError = '';
    try {
      const page = await adminClient.listCustomers({
        limit: 25,
        cursor: reset ? null : nextCursor ?? null,
        query: query || undefined,
        source_brand: sourceBrand || undefined,
      });
      rows = reset ? page.customers : [...rows, ...page.customers];
      nextCursor = page.next_cursor ?? null;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load customers';
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  function applyFilters(): void {
    writeQuery();
    void load(true);
  }

  onMount(() => {
    readQuery();
    void load(true);
  });

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-customers">
    <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 class="text-2xl font-semibold text-slate-900">Customers</h1>
        <p class="text-sm text-slate-500">All customers on the platform.</p>
      </div>
      <form
        on:submit|preventDefault={applyFilters}
        class="flex flex-wrap items-end gap-3"
        data-testid="admin-customers-filters"
      >
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Email
          <input
            type="search"
            placeholder="Search email"
            bind:value={query}
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            data-testid="admin-customers-search"
          />
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
        <button
          type="submit"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          data-testid="apply-filters"
        >
          Apply
        </button>
      </form>
    </header>

    {#if loading}
      <p class="text-sm text-slate-500">Loading…</p>
    {:else if loadError}
      <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </p>
    {:else if rows.length === 0}
      <p class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No customers found.
      </p>
    {:else}
      <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table class="min-w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Email</th>
              <th class="px-4 py-3">Brand</th>
              <th class="px-4 py-3">Plan</th>
              <th class="px-4 py-3">Balance</th>
              <th class="px-4 py-3">Accounts</th>
              <th class="px-4 py-3" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each rows as row (row.id)}
              <tr data-testid="admin-customer-row" data-source-brand={row.source_brand ?? ''}>
                <td class="px-4 py-3 font-mono text-slate-900">{row.email}</td>
                <td class="px-4 py-3 text-slate-700" data-testid="row-source-brand">
                  {row.source_brand ?? '—'}
                </td>
                <td class="px-4 py-3 text-slate-700">{row.plan_name ?? row.plan_id}</td>
                <td class="px-4 py-3 text-slate-700">{dollars(row.balance_cents)}</td>
                <td class="px-4 py-3 text-slate-700">{row.account_count}</td>
                <td class="px-4 py-3 text-right">
                  <Link
                    to={`/admin/customers/${encodeURIComponent(row.id)}`}
                    getProps={() => ({
                      class: 'text-slate-900 underline hover:text-slate-700',
                      'data-testid': 'admin-customer-link',
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
      {#if nextCursor}
        <div class="text-center">
          <button
            type="button"
            on:click={() => void load(false)}
            disabled={loadingMore}
            class="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      {/if}
    {/if}
  </section>
</AdminGuard>
