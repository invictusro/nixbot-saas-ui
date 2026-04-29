<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import {
    customerSubscriptionsClient,
    ApiError,
    type CustomerSubscriptionDetail,
    type CustomerSubscriptionState,
    type CustomerSubscriptionAssignment,
  } from '../lib/api';

  export let id: string;

  let detail: CustomerSubscriptionDetail | null = null;
  let loading = true;
  let loadError = '';
  let confirmingCancel = false;
  let cancelling = false;
  let cancelError = '';
  let cancelToast = '';

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

  type AssignmentDisplayStatus = 'creating' | 'warming' | 'active' | 'banned' | 'paused' | 'unknown';

  function displayStatus(a: CustomerSubscriptionAssignment): AssignmentDisplayStatus {
    if (a.pending_creation) return 'creating';
    const s = (a.status ?? '').toLowerCase();
    if (s === 'banned' || s === 'disabled' || s === 'flagged') return 'banned';
    if (s === 'paused') return 'paused';
    if (s === 'warming' || s === 'warmup' || s === 'warming_up') return 'warming';
    if (s === 'active' || s === 'ready' || s === 'posting') return 'active';
    return 'unknown';
  }

  function statusLabel(a: CustomerSubscriptionAssignment): string {
    return displayStatus(a);
  }

  function statusClass(a: CustomerSubscriptionAssignment): string {
    switch (displayStatus(a)) {
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

  function assignmentClickable(a: CustomerSubscriptionAssignment): boolean {
    return !a.pending_creation && a.account_id !== '';
  }

  function assignmentHref(a: CustomerSubscriptionAssignment): string {
    return `/subscriptions/${encodeURIComponent(id)}/accounts/${encodeURIComponent(a.account_id)}`;
  }

  function assignmentClick(a: CustomerSubscriptionAssignment): void {
    if (!assignmentClickable(a)) return;
    navigate(assignmentHref(a));
  }

  function assignmentKeydown(e: KeyboardEvent, a: CustomerSubscriptionAssignment): void {
    if (!assignmentClickable(a)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(assignmentHref(a));
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      detail = await customerSubscriptionsClient.get(id);
    } catch (e) {
      loadError =
        e instanceof ApiError && e.status === 404
          ? 'Subscription not found'
          : e instanceof Error
            ? e.message
            : 'Failed to load subscription';
    } finally {
      loading = false;
    }
  }

  function canCancel(s: CustomerSubscriptionState): boolean {
    return s === 'active' || s === 'paused';
  }

  function openConfirm(): void {
    cancelError = '';
    confirmingCancel = true;
  }

  function dismissConfirm(): void {
    if (cancelling) return;
    confirmingCancel = false;
  }

  async function confirmCancel(): Promise<void> {
    if (!detail) return;
    cancelling = true;
    cancelError = '';
    try {
      const res = await customerSubscriptionsClient.cancel(detail.id);
      const ends = res.ends_at ? fmtDate(res.ends_at) : '';
      cancelToast = ends
        ? `Will end on ${ends}, no refund.`
        : 'Cancellation scheduled. No refund.';
      confirmingCancel = false;
      await load();
    } catch (e) {
      cancelError =
        e instanceof ApiError
          ? e.status === 404
            ? 'Subscription not found.'
            : e.status === 409
              ? 'This subscription cannot be cancelled in its current state.'
              : e.message
          : e instanceof Error
            ? e.message
            : 'Failed to cancel subscription';
    } finally {
      cancelling = false;
    }
  }

  function dismissToast(): void {
    cancelToast = '';
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-6" data-testid="customer-subscription-detail">
  <div class="flex items-center gap-3 text-sm text-slate-500">
    <Link to="/subscriptions" getProps={() => ({ class: 'underline hover:text-slate-900' })}>
      ← Subscriptions
    </Link>
  </div>

  {#if loading}
    <p class="text-sm text-slate-500" data-testid="customer-subscription-detail-loading">Loading…</p>
  {:else if loadError}
    <p
      role="alert"
      class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700"
      data-testid="customer-subscription-detail-error"
    >
      {loadError}
    </p>
  {:else if detail}
    <header class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">
            {detail.sku_name}
            <span
              class="ml-2 inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-medium {stateClass(detail.state)}"
              data-testid="customer-subscription-detail-state"
            >
              {stateLabel(detail.state)}
            </span>
          </h1>
          <p class="mt-1 text-sm text-slate-500">
            <span class="font-mono" data-testid="customer-subscription-detail-sku-code">
              {detail.sku_code}
            </span>
            · started <span data-testid="customer-subscription-detail-started">
              {fmtDate(detail.started_at)}
            </span>
          </p>
        </div>
        <div class="text-right text-sm">
          <p
            class="text-2xl font-semibold tabular-nums text-slate-900"
            data-testid="customer-subscription-detail-monthly"
            data-cents={detail.monthly_price_cents}
          >
            {fmtPrice(detail.monthly_price_cents)}
          </p>
          <p class="text-xs uppercase tracking-wide text-slate-500">monthly</p>
        </div>
      </div>

      {#if canCancel(detail.state) && detail.next_renewal_at}
        <div
          class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
          data-testid="customer-subscription-renewal-banner"
        >
          <p class="text-slate-700">
            Next renewal:
            <span class="font-medium text-slate-900" data-testid="customer-subscription-renewal-banner-date">
              {fmtDate(detail.next_renewal_at)}
            </span>
            for
            <span
              class="font-medium tabular-nums text-slate-900"
              data-testid="customer-subscription-renewal-banner-price"
              data-cents={detail.monthly_price_cents}
            >
              {fmtPrice(detail.monthly_price_cents)}
            </span>
          </p>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300"
            data-testid="customer-subscription-cancel-button"
            on:click={openConfirm}
          >
            Cancel subscription
          </button>
        </div>
      {/if}
      <dl class="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt class="text-xs uppercase tracking-wide text-slate-500">Next renewal</dt>
          <dd
            class="mt-1 text-slate-900"
            data-testid="customer-subscription-detail-next-renewal"
          >
            {fmtDate(detail.next_renewal_at)}
          </dd>
        </div>
        {#if detail.account_count !== null && detail.account_count !== undefined}
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Accounts</dt>
            <dd class="mt-1 text-slate-900" data-testid="customer-subscription-detail-account-count">
              {detail.account_count}
            </dd>
          </div>
        {/if}
        {#if detail.posts_per_week !== null && detail.posts_per_week !== undefined}
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Posts / week</dt>
            <dd class="mt-1 text-slate-900" data-testid="customer-subscription-detail-posts-per-week">
              {detail.posts_per_week}
            </dd>
          </div>
        {/if}
        {#if detail.cancel_at_cycle !== null && detail.cancel_at_cycle !== undefined}
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Ends after</dt>
            <dd class="mt-1 text-slate-900" data-testid="customer-subscription-detail-cancel-at-cycle">
              {detail.cancel_at_cycle} cycles
            </dd>
          </div>
        {/if}
      </dl>
    </header>

    <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Managed accounts
        </h2>
        <span class="text-xs text-slate-500">read-only</span>
      </header>
      {#if detail.assignments.length === 0}
        <p
          class="px-5 py-6 text-sm text-slate-500"
          data-testid="customer-subscription-assignments-empty"
        >
          No accounts have been assigned to this subscription yet. They'll appear here as the
          team allocates them.
        </p>
      {:else}
        <table class="min-w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">IG handle</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3 text-right">Warmup days</th>
              <th class="px-4 py-3">Next post</th>
              <th class="px-4 py-3" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each detail.assignments as a (a.id)}
              <tr
                class="{assignmentClickable(a)
                  ? 'cursor-pointer hover:bg-slate-50'
                  : 'text-slate-400'}"
                role={assignmentClickable(a) ? 'link' : undefined}
                tabindex={assignmentClickable(a) ? 0 : -1}
                on:click={() => assignmentClick(a)}
                on:keydown={(e) => assignmentKeydown(e, a)}
                data-testid="customer-subscription-assignment"
                data-assignment-id={a.id}
                data-account-id={a.account_id}
                data-status={statusLabel(a)}
                data-pending-creation={a.pending_creation ? 'true' : 'false'}
              >
                <td class="px-4 py-3 font-mono text-slate-900">
                  {#if a.pending_creation}
                    <span class="italic text-slate-500" data-testid="customer-subscription-assignment-handle">
                      being created
                    </span>
                  {:else}
                    <span data-testid="customer-subscription-assignment-handle">@{a.username}</span>
                  {/if}
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {statusClass(a)}"
                    data-testid="customer-subscription-assignment-status"
                  >
                    {statusLabel(a)}
                  </span>
                </td>
                <td
                  class="px-4 py-3 text-right tabular-nums text-slate-700"
                  data-testid="customer-subscription-assignment-warmup-days"
                >
                  {a.warmup_days}
                </td>
                <td
                  class="px-4 py-3 text-slate-700"
                  data-testid="customer-subscription-assignment-next-post"
                >
                  {fmtDateTime(a.next_post_at)}
                </td>
                <td class="px-4 py-3 text-right">
                  {#if assignmentClickable(a)}
                    <Link
                      to={assignmentHref(a)}
                      getProps={() => ({
                        class: 'text-slate-900 underline hover:text-slate-700',
                        'data-testid': 'customer-subscription-assignment-link',
                      })}
                    >
                      Open
                    </Link>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if confirmingCancel && detail}
    <div
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-subscription-cancel-title"
      data-testid="customer-subscription-cancel-confirm"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2
          id="customer-subscription-cancel-title"
          class="text-lg font-semibold text-slate-900"
        >
          Cancel this subscription?
        </h2>
        <p
          class="mt-2 text-sm text-slate-600"
          data-testid="customer-subscription-cancel-confirm-message"
        >
          Your subscription stays active until
          <span class="font-medium text-slate-900">
            {fmtDate(detail.next_renewal_at)}
          </span>. After that it will end and you won't be charged again.
          No refund is issued for the current cycle.
        </p>
        {#if cancelError}
          <p
            role="alert"
            class="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
            data-testid="customer-subscription-cancel-error"
          >
            {cancelError}
          </p>
        {/if}
        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid="customer-subscription-cancel-dismiss"
            on:click={dismissConfirm}
            disabled={cancelling}
          >
            Keep subscription
          </button>
          <button
            type="button"
            class="rounded-md border border-rose-600 bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            data-testid="customer-subscription-cancel-confirm-button"
            on:click={confirmCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Yes, cancel at cycle end'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if cancelToast}
    <div
      role="status"
      class="fixed bottom-6 right-6 z-40 max-w-sm rounded-md border border-emerald-300 bg-white px-4 py-3 text-sm text-emerald-800 shadow-lg"
      data-testid="customer-subscription-cancel-toast"
    >
      <div class="flex items-start gap-3">
        <p class="flex-1">{cancelToast}</p>
        <button
          type="button"
          class="text-emerald-700 underline hover:text-emerald-900"
          on:click={dismissToast}
        >
          Dismiss
        </button>
      </div>
    </div>
  {/if}
</section>
