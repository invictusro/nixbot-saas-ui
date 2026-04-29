<script lang="ts">
  import { onMount } from 'svelte';
  import { Link } from 'svelte-routing';
  import {
    customerSubscriptionsClient,
    ApiError,
    type CustomerSubscriptionAccountDrill,
    type CustomerSubscriptionAccountDelivery,
  } from '../lib/api';

  export let id: string;
  export let accountId: string;

  let drill: CustomerSubscriptionAccountDrill | null = null;
  let loading = true;
  let loadError = '';
  let loadStatus = 0;

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function fmtDateTime(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  type DisplayStatus = 'creating' | 'warming' | 'active' | 'banned' | 'paused' | 'unknown';

  function displayStatus(raw: string): DisplayStatus {
    const s = (raw ?? '').toLowerCase();
    if (s === 'creating' || s === 'pending_creation') return 'creating';
    if (s === 'banned' || s === 'disabled' || s === 'flagged') return 'banned';
    if (s === 'paused') return 'paused';
    if (s === 'warming' || s === 'warmup' || s === 'warming_up') return 'warming';
    if (s === 'active' || s === 'ready' || s === 'posting') return 'active';
    return 'unknown';
  }

  function statusClass(raw: string): string {
    switch (displayStatus(raw)) {
      case 'active':
        return 'bg-emerald-100 text-emerald-800';
      case 'warming':
        return 'bg-amber-100 text-amber-800';
      case 'banned':
        return 'bg-rose-100 text-rose-800';
      case 'paused':
        return 'bg-slate-200 text-slate-800';
      case 'creating':
        return 'bg-sky-100 text-sky-800';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  function deliveryStateClass(state: CustomerSubscriptionAccountDelivery['state']): string {
    switch (state) {
      case 'posted':
        return 'bg-emerald-100 text-emerald-700';
      case 'failed':
        return 'bg-rose-100 text-rose-700';
      case 'missing':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    loadStatus = 0;
    try {
      drill = await customerSubscriptionsClient.getAccount(id, accountId);
    } catch (e) {
      if (e instanceof ApiError) {
        loadStatus = e.status;
        if (e.status === 404) {
          loadError = 'Subscription not found';
        } else if (e.status === 403) {
          loadError = "This account isn't part of your subscription.";
        } else {
          loadError = e.message;
        }
      } else if (e instanceof Error) {
        loadError = e.message;
      } else {
        loadError = 'Failed to load account';
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-6" data-testid="customer-subscription-account-detail">
  <div class="flex items-center gap-3 text-sm text-slate-500">
    <Link
      to={`/subscriptions/${encodeURIComponent(id)}`}
      getProps={() => ({ class: 'underline hover:text-slate-900' })}
    >
      ← Subscription
    </Link>
  </div>

  {#if loading}
    <p
      class="text-sm text-slate-500"
      data-testid="customer-subscription-account-loading"
    >
      Loading…
    </p>
  {:else if loadError}
    <p
      role="alert"
      class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700"
      data-testid="customer-subscription-account-error"
      data-status={loadStatus}
    >
      {loadError}
    </p>
  {:else if drill}
    <header
      class="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div class="min-w-0">
        <h1
          class="truncate text-2xl font-semibold text-slate-900"
          data-testid="customer-subscription-account-handle"
        >
          @{drill.username}
        </h1>
        <p class="mt-1 text-xs text-slate-500">
          <span class="font-mono" data-testid="customer-subscription-account-sku-code">
            {drill.sku_code}
          </span>
          · assigned <span data-testid="customer-subscription-account-started">
            {fmtDate(drill.started_at)}
          </span>
        </p>
      </div>
      <div class="flex flex-col items-end gap-2">
        <span
          class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {statusClass(drill.status)}"
          data-testid="customer-subscription-account-status"
          data-status={displayStatus(drill.status)}
        >
          {displayStatus(drill.status)}
        </span>
        <span class="text-xs text-slate-500">read-only</span>
      </div>
    </header>

    <dl
      class="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-5 text-sm shadow-sm sm:grid-cols-4"
      data-testid="customer-subscription-account-stats"
    >
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Warmup days</dt>
        <dd
          class="mt-1 text-slate-900 tabular-nums"
          data-testid="customer-subscription-account-warmup-days"
        >
          {drill.warmup_days}
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Next post</dt>
        <dd
          class="mt-1 text-slate-900"
          data-testid="customer-subscription-account-next-post"
        >
          {fmtDateTime(drill.next_post_at)}
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Posts total</dt>
        <dd
          class="mt-1 text-slate-900 tabular-nums"
          data-testid="customer-subscription-account-posts-total"
        >
          {drill.posts_total}
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Posts posted</dt>
        <dd
          class="mt-1 text-slate-900 tabular-nums"
          data-testid="customer-subscription-account-posts-posted"
        >
          {drill.posts_posted}
        </dd>
      </div>
    </dl>

    <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Post activity
        </h2>
        <span class="text-xs text-slate-500">read-only</span>
      </header>
      {#if drill.deliveries.length === 0}
        <p
          class="px-5 py-6 text-sm text-slate-500"
          data-testid="customer-subscription-account-deliveries-empty"
        >
          No posts have been made on this account yet for this subscription.
        </p>
      {:else}
        <ul
          class="divide-y divide-slate-100"
          data-testid="customer-subscription-account-deliveries"
        >
          {#each drill.deliveries as d (d.id)}
            <li
              class="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              data-testid="customer-subscription-account-delivery"
              data-state={d.state}
            >
              <div class="min-w-0">
                <p class="text-sm text-slate-900">
                  {fmtDateTime(d.posted_at)}
                </p>
                {#if d.ig_post_url}
                  <a
                    href={d.ig_post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-xs text-slate-500 underline hover:text-slate-700"
                    data-testid="customer-subscription-account-delivery-link"
                  >
                    View on Instagram ↗
                  </a>
                {/if}
              </div>
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {deliveryStateClass(d.state)}"
                data-testid="customer-subscription-account-delivery-state"
              >
                {d.state}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>
