<script lang="ts">
  import { onMount } from 'svelte';
  import { Link } from 'svelte-routing';
  import {
    customerOrdersClient,
    ApiError,
    type CustomerOrderDetail,
    type CustomerOrderState,
    type CustomerDeliveryState,
  } from '../lib/api';

  export let id: string;

  let detail: CustomerOrderDetail | null = null;
  let loading = true;
  let loadError = '';

  let confirmOpen = false;
  let cancelling = false;
  let cancelError = '';
  let cancelSuccess = '';

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function progressPercent(d: CustomerOrderDetail): number {
    if (d.posts_total <= 0) return 0;
    const p = Math.round((d.posts_done / d.posts_total) * 100);
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

  function deliveryIcon(state: CustomerDeliveryState): string {
    switch (state) {
      case 'posted':
        return '✓';
      case 'failed':
        return '✕';
      case 'missing':
        return '⚠';
      default:
        return '·';
    }
  }

  function deliveryIconClass(state: CustomerDeliveryState): string {
    switch (state) {
      case 'posted':
        return 'bg-emerald-100 text-emerald-700';
      case 'failed':
        return 'bg-rose-100 text-rose-700';
      case 'missing':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }

  function deliveryTooltip(state: CustomerDeliveryState): string {
    switch (state) {
      case 'posted':
        return 'Reel posted successfully';
      case 'failed':
        return 'Reel failed to post — the system will retry from the queue';
      case 'missing':
        return 'Reel was posted but is no longer visible on Instagram';
      default:
        return '';
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      detail = await customerOrdersClient.get(id);
    } catch (e) {
      loadError =
        e instanceof ApiError && e.status === 404
          ? 'Order not found'
          : e instanceof Error
            ? e.message
            : 'Failed to load order';
    } finally {
      loading = false;
    }
  }

  function fmtCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function openConfirm(): void {
    cancelError = '';
    confirmOpen = true;
  }

  function closeConfirm(): void {
    if (cancelling) return;
    confirmOpen = false;
  }

  async function confirmCancel(): Promise<void> {
    if (cancelling) return;
    cancelling = true;
    cancelError = '';
    try {
      const res = await customerOrdersClient.cancel(id);
      confirmOpen = false;
      if (res.refunded && res.amount_cents) {
        cancelSuccess = `Order cancelled — ${fmtCents(res.amount_cents)} credited to your balance.`;
      } else {
        cancelSuccess = 'Order cancelled.';
      }
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        cancelError = 'Cancel is no longer available — this order has started processing.';
      } else if (e instanceof ApiError && e.status === 404) {
        cancelError = 'Order not found.';
      } else if (e instanceof Error) {
        cancelError = e.message;
      } else {
        cancelError = 'Cancel failed.';
      }
    } finally {
      cancelling = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-6" data-testid="customer-order-detail">
  <div class="flex items-center gap-3 text-sm text-slate-500">
    <Link to="/orders" getProps={() => ({ class: 'underline hover:text-slate-900' })}>
      ← Orders
    </Link>
  </div>

  {#if loading}
    <p class="text-sm text-slate-500" data-testid="customer-order-detail-loading">Loading…</p>
  {:else if loadError}
    <p
      role="alert"
      class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700"
      data-testid="customer-order-detail-error"
    >
      {loadError}
    </p>
  {:else if detail}
    {#if cancelSuccess}
      <p
        role="status"
        class="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800"
        data-testid="customer-order-cancel-success"
      >
        {cancelSuccess}
      </p>
    {/if}
    <header class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">
            {detail.sku_name}
            <span
              class="ml-2 inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-medium {stateClass(detail.state)}"
              data-testid="customer-order-detail-state"
            >
              {detail.state}
            </span>
          </h1>
          <p class="mt-1 text-sm text-slate-500">
            <span class="font-mono" data-testid="customer-order-detail-sku-code">{detail.sku_code}</span>
            · ordered <span data-testid="customer-order-detail-created">{fmtDate(detail.created_at)}</span>
            {#if detail.completed_at}
              · completed <span data-testid="customer-order-detail-completed">{fmtDate(detail.completed_at)}</span>
            {/if}
          </p>
        </div>
        {#if detail.state === 'pending'}
          <button
            type="button"
            class="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-50"
            on:click={openConfirm}
            disabled={cancelling}
            data-testid="customer-order-cancel-button"
          >
            Cancel order
          </button>
        {/if}
      </div>
      <div class="mt-4 flex items-center gap-3" data-testid="customer-order-detail-progress">
        <div class="h-2 w-48 overflow-hidden rounded-full bg-slate-200">
          <div
            class="h-full bg-slate-900"
            style="width: {progressPercent(detail)}%"
            data-testid="customer-order-detail-progress-bar"
            data-percent={progressPercent(detail)}
          ></div>
        </div>
        <span class="text-sm tabular-nums text-slate-600">
          {detail.posts_done}/{detail.posts_total} posted
        </span>
      </div>
    </header>

    <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header class="border-b border-slate-200 px-5 py-3">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
      </header>
      {#if detail.deliveries.length === 0}
        <p class="px-5 py-6 text-sm text-slate-500" data-testid="customer-order-timeline-empty">
          No reels have been posted yet. New deliveries will appear here as they happen.
        </p>
      {:else}
        <ol class="divide-y divide-slate-100" data-testid="customer-order-timeline">
          {#each detail.deliveries as d (d.id)}
            <li
              class="flex items-center gap-4 px-5 py-3"
              data-testid="customer-order-delivery"
              data-state={d.state}
            >
              <span
                class="flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-bold {deliveryIconClass(d.state)}"
                title={deliveryTooltip(d.state)}
                aria-label={d.state}
                data-testid="customer-order-delivery-icon"
              >
                {deliveryIcon(d.state)}
              </span>
              <div class="flex-1 text-sm">
                <span class="font-mono text-slate-700" data-testid="customer-order-delivery-time">
                  {fmtDate(d.posted_at)}
                </span>
                <span class="ml-2 text-slate-500" data-testid="customer-order-delivery-state">
                  {d.state}
                </span>
              </div>
              {#if d.state === 'posted' && d.ig_post_url}
                <a
                  href={d.ig_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-slate-900 underline hover:text-slate-700"
                  data-testid="customer-order-delivery-link"
                >
                  View on Instagram
                </a>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if confirmOpen}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-order-cancel-title"
      data-testid="customer-order-cancel-dialog"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="customer-order-cancel-title" class="text-lg font-semibold text-slate-900">
          Cancel this order?
        </h2>
        <p class="mt-2 text-sm text-slate-600">
          Your order will be cancelled and the full purchase amount will be credited
          back to your account balance. This is only possible while the order is
          still pending review — once it starts processing, cancellation is no
          longer available.
        </p>
        {#if cancelError}
          <p
            role="alert"
            class="mt-3 rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-700"
            data-testid="customer-order-cancel-error"
          >
            {cancelError}
          </p>
        {/if}
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            on:click={closeConfirm}
            disabled={cancelling}
            data-testid="customer-order-cancel-keep"
          >
            Keep order
          </button>
          <button
            type="button"
            class="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            on:click={confirmCancel}
            disabled={cancelling}
            data-testid="customer-order-cancel-confirm"
          >
            {cancelling ? 'Cancelling…' : 'Cancel and refund'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
