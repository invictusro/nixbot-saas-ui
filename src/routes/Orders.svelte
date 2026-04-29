<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import {
    customerOrdersClient,
    type CustomerOrderRow,
    type CustomerOrderState,
  } from '../lib/api';

  let rows: CustomerOrderRow[] = [];
  let loading = true;
  let loadError = '';

  function fmtDate(s: string): string {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function progressPercent(row: CustomerOrderRow): number {
    if (row.posts_total <= 0) return 0;
    const p = Math.round((row.posts_done / row.posts_total) * 100);
    return Math.max(0, Math.min(100, p));
  }

  function stateClass(state: CustomerOrderState): string {
    switch (state) {
      case 'pending':
        return 'bg-amber-100 text-amber-800';
      case 'active':
        return 'bg-emerald-100 text-emerald-800';
      case 'paused':
        return 'bg-slate-200 text-slate-800';
      case 'completed':
        return 'bg-sky-100 text-sky-800';
      case 'cancelled':
      case 'refunded':
        return 'bg-rose-100 text-rose-800';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  function rowKeydown(e: KeyboardEvent, id: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/orders/${encodeURIComponent(id)}`);
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      rows = await customerOrdersClient.list();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load orders';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-6" data-testid="customer-orders">
  <header class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h1 class="text-2xl font-semibold text-slate-900">Your orders</h1>
    <p class="text-sm text-slate-500">Reels packs you've purchased and their delivery progress.</p>
  </header>

  {#if loading}
    <p class="text-sm text-slate-500" data-testid="customer-orders-loading">Loading…</p>
  {:else if loadError}
    <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
      {loadError}
    </p>
  {:else if rows.length === 0}
    <p
      class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500"
      data-testid="customer-orders-empty"
    >
      You haven't placed any orders yet.
    </p>
  {:else}
    <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3">Created</th>
            <th class="px-4 py-3">Product</th>
            <th class="px-4 py-3">SKU</th>
            <th class="px-4 py-3">State</th>
            <th class="px-4 py-3">Progress</th>
            <th class="px-4 py-3" aria-label="actions"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each rows as row (row.id)}
            <tr
              role="link"
              tabindex="0"
              class="cursor-pointer hover:bg-slate-50"
              on:click={() => navigate(`/orders/${encodeURIComponent(row.id)}`)}
              on:keydown={(e) => rowKeydown(e, row.id)}
              data-testid="customer-order-row"
              data-state={row.state}
            >
              <td class="px-4 py-3 text-slate-700">{fmtDate(row.created_at)}</td>
              <td class="px-4 py-3 text-slate-900">{row.sku_name}</td>
              <td class="px-4 py-3 font-mono text-xs text-slate-500">{row.sku_code}</td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {stateClass(row.state)}"
                  data-testid="customer-order-state"
                >
                  {row.state}
                </span>
              </td>
              <td class="px-4 py-3 text-slate-700" data-testid="customer-order-progress">
                <div class="flex items-center gap-3">
                  <div class="h-2 w-32 overflow-hidden rounded-full bg-slate-200">
                    <div
                      class="h-full bg-slate-900"
                      style="width: {progressPercent(row)}%"
                      data-testid="customer-order-progress-bar"
                      data-percent={progressPercent(row)}
                    ></div>
                  </div>
                  <span class="text-xs tabular-nums text-slate-600">
                    {row.posts_done}/{row.posts_total}
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 text-right">
                <Link
                  to={`/orders/${encodeURIComponent(row.id)}`}
                  getProps={() => ({
                    class: 'text-slate-900 underline hover:text-slate-700',
                    'data-testid': 'customer-order-link',
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
  {/if}
</section>
