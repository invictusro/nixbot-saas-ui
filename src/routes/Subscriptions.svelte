<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import {
    customerSubscriptionsClient,
    type CustomerSubscriptionRow,
    type CustomerSubscriptionState,
  } from '../lib/api';

  let rows: CustomerSubscriptionRow[] = [];
  let loading = true;
  let loadError = '';

  function fmtRenewal(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function fmtPrice(cents: number): string {
    const dollars = (cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `$${dollars}`;
  }

  function stateLabel(state: CustomerSubscriptionState): string {
    if (state === 'pending_cancellation') return 'cancelling';
    if (state === 'pending_activation') return 'pending activation';
    return state;
  }

  function stateClass(state: CustomerSubscriptionState): string {
    switch (state) {
      case 'active':
        return 'bg-emerald-100 text-emerald-800';
      case 'pending_activation':
        return 'bg-amber-100 text-amber-800';
      case 'pending_cancellation':
        return 'bg-rose-100 text-rose-800 ring-1 ring-rose-300';
      case 'paused':
        return 'bg-slate-200 text-slate-800';
      case 'cancelled':
      case 'expired':
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  function rowKeydown(e: KeyboardEvent, id: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/subscriptions/${encodeURIComponent(id)}`);
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      rows = await customerSubscriptionsClient.list();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load subscriptions';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-6" data-testid="customer-subscriptions">
  <header class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h1 class="text-2xl font-semibold text-slate-900">Your subscriptions</h1>
    <p class="text-sm text-slate-500">Recurring plans, their next renewal, and monthly cost.</p>
  </header>

  {#if loading}
    <p class="text-sm text-slate-500" data-testid="customer-subscriptions-loading">Loading…</p>
  {:else if loadError}
    <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
      {loadError}
    </p>
  {:else if rows.length === 0}
    <p
      class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500"
      data-testid="customer-subscriptions-empty"
    >
      You don't have any subscriptions yet.
    </p>
  {:else}
    <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3">Product</th>
            <th class="px-4 py-3">SKU</th>
            <th class="px-4 py-3">State</th>
            <th class="px-4 py-3">Next renewal</th>
            <th class="px-4 py-3 text-right">Monthly</th>
            <th class="px-4 py-3" aria-label="actions"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each rows as row (row.id)}
            <tr
              role="link"
              tabindex="0"
              class="cursor-pointer hover:bg-slate-50"
              on:click={() => navigate(`/subscriptions/${encodeURIComponent(row.id)}`)}
              on:keydown={(e) => rowKeydown(e, row.id)}
              data-testid="customer-subscription-row"
              data-state={row.state}
            >
              <td class="px-4 py-3 text-slate-900">{row.sku_name}</td>
              <td class="px-4 py-3 font-mono text-xs text-slate-500">{row.sku_code}</td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {stateClass(row.state)}"
                  data-testid="customer-subscription-state"
                >
                  {stateLabel(row.state)}
                </span>
              </td>
              <td class="px-4 py-3 text-slate-700" data-testid="customer-subscription-next-renewal">
                {fmtRenewal(row.next_renewal_at)}
              </td>
              <td
                class="px-4 py-3 text-right tabular-nums text-slate-900"
                data-testid="customer-subscription-monthly"
                data-cents={row.monthly_price_cents}
              >
                {fmtPrice(row.monthly_price_cents)}
              </td>
              <td class="px-4 py-3 text-right">
                <Link
                  to={`/subscriptions/${encodeURIComponent(row.id)}`}
                  getProps={() => ({
                    class: 'text-slate-900 underline hover:text-slate-700',
                    'data-testid': 'customer-subscription-link',
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
