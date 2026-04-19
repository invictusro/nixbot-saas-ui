<script lang="ts">
  import { onMount } from 'svelte';
  import { Link } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import { adminClient, type AdminCustomerRow } from '../lib/api';

  let rows: AdminCustomerRow[] = [];
  let nextCursor: string | null | undefined = null;
  let query = '';
  let loading = true;
  let loadError = '';
  let loadingMore = false;

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

  onMount(() => {
    void load(true);
  });

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function onSearchSubmit(e: Event): void {
    e.preventDefault();
    void load(true);
  }
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-customers">
    <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 class="text-2xl font-semibold text-slate-900">Customers</h1>
        <p class="text-sm text-slate-500">All customers on the platform.</p>
      </div>
      <form on:submit={onSearchSubmit} class="flex items-center gap-2">
        <input
          type="search"
          placeholder="Search email"
          bind:value={query}
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          data-testid="admin-customers-search"
        />
        <button
          type="submit"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
        >
          Search
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
              <th class="px-4 py-3">Plan</th>
              <th class="px-4 py-3">Balance</th>
              <th class="px-4 py-3">Accounts</th>
              <th class="px-4 py-3" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each rows as row (row.id)}
              <tr data-testid="admin-customer-row">
                <td class="px-4 py-3 font-mono text-slate-900">{row.email}</td>
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
