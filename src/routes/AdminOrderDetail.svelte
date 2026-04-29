<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import {
    adminClient,
    ApiError,
    type AdminOrderDetail,
    type AdminOrderStartOpts,
    type AdminOrderPoolPreview,
  } from '../lib/api';

  export let id: string;

  let detail: AdminOrderDetail | null = null;
  let loading = true;
  let loadError = '';

  let postsPerDay = '';
  let activeHoursStart = '';
  let activeHoursEnd = '';
  let poolFilterText = '{}';
  let poolFilterErr = '';

  let startPending = false;
  let startError = '';

  let preview: AdminOrderPoolPreview | null = null;
  let previewLoading = false;
  let previewError = '';
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewSeq = 0;
  const PREVIEW_DEBOUNCE_MS = 500;

  let pausePending = false;
  let resumePending = false;
  let cancelDialogOpen = false;
  let cancelRefund = false;
  let cancelPending = false;
  let actionError = '';

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function prettyJSON(v: unknown): string {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      detail = await adminClient.getOrder(id);
      postsPerDay = detail.posts_per_day != null ? String(detail.posts_per_day) : '';
      activeHoursStart = detail.active_hours_start != null ? String(detail.active_hours_start) : '';
      activeHoursEnd = detail.active_hours_end != null ? String(detail.active_hours_end) : '';
      poolFilterText = prettyJSON(detail.account_pool_filter_json ?? {});
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

  function parsePoolFilter(): Record<string, unknown> | null {
    poolFilterErr = '';
    const txt = poolFilterText.trim();
    if (!txt) return {};
    try {
      const parsed = JSON.parse(txt) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        poolFilterErr = 'Pool filter must be a JSON object';
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      poolFilterErr = e instanceof Error ? e.message : 'Invalid JSON';
      return null;
    }
  }

  $: ppdNum = postsPerDay === '' ? null : Number(postsPerDay);
  $: ahsNum = activeHoursStart === '' ? null : Number(activeHoursStart);
  $: aheNum = activeHoursEnd === '' ? null : Number(activeHoursEnd);

  $: ppdValid = ppdNum !== null && Number.isInteger(ppdNum) && ppdNum > 0;
  $: ahsValid =
    ahsNum !== null && Number.isInteger(ahsNum) && ahsNum >= 0 && ahsNum <= 23;
  $: aheValid =
    aheNum !== null && Number.isInteger(aheNum) && aheNum >= 0 && aheNum <= 23;
  $: poolFilterLooksValid = (() => {
    const t = poolFilterText.trim();
    if (!t) return true;
    try {
      const v = JSON.parse(t) as unknown;
      return v !== null && typeof v === 'object' && !Array.isArray(v);
    } catch {
      return false;
    }
  })();

  $: canStart =
    !startPending &&
    ppdValid &&
    ahsValid &&
    aheValid &&
    poolFilterLooksValid;

  function schedulePreview(filterText: string, ppd: number | null): void {
    if (!detail || detail.state !== 'pending') return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void runPreview(filterText, ppd);
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function runPreview(filterText: string, ppd: number | null): Promise<void> {
    const trimmed = filterText.trim();
    let parsed: Record<string, unknown> = {};
    if (trimmed) {
      try {
        const v = JSON.parse(trimmed) as unknown;
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          previewError = 'Pool filter must be a JSON object';
          previewLoading = false;
          preview = null;
          return;
        }
        parsed = v as Record<string, unknown>;
      } catch (e) {
        previewError = e instanceof Error ? e.message : 'Invalid JSON';
        previewLoading = false;
        preview = null;
        return;
      }
    }
    const seq = ++previewSeq;
    previewLoading = true;
    previewError = '';
    try {
      const opts: { account_pool_filter_json: Record<string, unknown>; posts_per_day?: number } = {
        account_pool_filter_json: parsed,
      };
      if (ppd !== null && Number.isInteger(ppd) && ppd > 0) opts.posts_per_day = ppd;
      const res = await adminClient.previewOrderPool(id, opts);
      if (seq !== previewSeq) return;
      preview = res;
    } catch (e) {
      if (seq !== previewSeq) return;
      previewError = e instanceof Error ? e.message : 'Preview failed';
      preview = null;
    } finally {
      if (seq === previewSeq) previewLoading = false;
    }
  }

  $: if (detail && detail.state === 'pending') {
    schedulePreview(poolFilterText, ppdNum);
  }

  async function pause(): Promise<void> {
    if (!detail || pausePending) return;
    pausePending = true;
    actionError = '';
    try {
      await adminClient.pauseOrder(id);
      await load();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to pause order';
    } finally {
      pausePending = false;
    }
  }

  async function resume(): Promise<void> {
    if (!detail || resumePending) return;
    resumePending = true;
    actionError = '';
    try {
      await adminClient.resumeOrder(id);
      await load();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to resume order';
    } finally {
      resumePending = false;
    }
  }

  function openCancel(): void {
    actionError = '';
    cancelRefund = detail?.state === 'pending';
    cancelDialogOpen = true;
  }

  function closeCancel(): void {
    if (cancelPending) return;
    cancelDialogOpen = false;
  }

  async function confirmCancel(): Promise<void> {
    if (!detail || cancelPending) return;
    const wantsRefund = detail.state === 'pending' && cancelRefund;
    cancelPending = true;
    actionError = '';
    try {
      const res = await adminClient.cancelOrder(id, wantsRefund ? { refund: true } : {});
      const msg = res.refunded
        ? `Cancelled order ${detail.sku_code} and refunded $${(res.amount_cents ?? 0) / 100}`
        : `Cancelled order ${detail.sku_code}`;
      sessionStorage.setItem('admin-orders-toast', msg);
      navigate('/admin/orders');
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to cancel order';
    } finally {
      cancelPending = false;
      cancelDialogOpen = false;
    }
  }

  async function start(): Promise<void> {
    if (!detail) return;
    if (!canStart) return;
    const pool = parsePoolFilter();
    if (pool === null) return;
    const opts: AdminOrderStartOpts = {
      posts_per_day: Number(postsPerDay),
      active_hours_start: Number(activeHoursStart),
      active_hours_end: Number(activeHoursEnd),
      account_pool_filter_json: pool,
    };
    startPending = true;
    startError = '';
    try {
      await adminClient.startOrder(id, opts);
      sessionStorage.setItem(
        'admin-orders-toast',
        `Started order ${detail.sku_code} for ${detail.customer_email}`,
      );
      navigate('/admin/orders');
    } catch (e) {
      startError = e instanceof Error ? e.message : 'Failed to start order';
    } finally {
      startPending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-order-detail">
    <div class="flex items-center gap-3 text-sm text-slate-500">
      <Link to="/admin/orders" getProps={() => ({ class: 'underline hover:text-slate-900' })}>
        ← Orders
      </Link>
    </div>

    {#if loading}
      <p class="text-sm text-slate-500" data-testid="order-detail-loading">Loading…</p>
    {:else if loadError}
      <p
        role="alert"
        class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700"
        data-testid="order-detail-error"
      >
        {loadError}
      </p>
    {:else if detail}
      <header
        class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">
            {detail.sku_code}
            <span
              class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-600"
              data-testid="order-state-badge"
            >
              {detail.state}
            </span>
          </h1>
          <p class="text-sm text-slate-500">
            <span class="font-mono" data-testid="order-customer-email">{detail.customer_email}</span>
            · brand <span data-testid="order-source-brand">{detail.source_brand}</span>
            · progress
            <span data-testid="order-progress">{detail.posts_done}/{detail.posts_total}</span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2" data-testid="order-actions">
          {#if detail.state === 'active'}
            <button
              type="button"
              on:click={pause}
              disabled={pausePending}
              class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="order-pause-button"
            >
              {pausePending ? 'Pausing…' : 'Pause'}
            </button>
          {/if}
          {#if detail.state === 'paused'}
            <button
              type="button"
              on:click={resume}
              disabled={resumePending}
              class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="order-resume-button"
            >
              {resumePending ? 'Resuming…' : 'Resume'}
            </button>
          {/if}
          {#if detail.state === 'pending' || detail.state === 'active' || detail.state === 'paused'}
            <button
              type="button"
              on:click={openCancel}
              class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              data-testid="order-cancel-button"
            >
              Cancel
            </button>
          {/if}
        </div>
      </header>

      {#if actionError}
        <p
          role="alert"
          class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
          data-testid="order-action-error"
        >
          {actionError}
        </p>
      {/if}

      <div class="grid gap-4 md:grid-cols-2">
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Order</h2>
          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt class="text-slate-500">Created</dt>
            <dd class="font-mono text-slate-900">{fmtDate(detail.created_at)}</dd>
            <dt class="text-slate-500">Started at</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="order-started-at"
            >{fmtDate(detail.started_at)}</dd>
            <dt class="text-slate-500">Started by</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="order-started-by"
            >{detail.started_by ?? '—'}</dd>
            <dt class="text-slate-500">Last post</dt>
            <dd class="font-mono text-slate-900">{fmtDate(detail.last_post_at)}</dd>
            <dt class="text-slate-500">Completed</dt>
            <dd class="font-mono text-slate-900">{fmtDate(detail.completed_at)}</dd>
          </dl>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">SKU metadata</h2>
          <pre
            class="mt-3 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs text-slate-700"
            data-testid="order-sku-metadata"
          >{prettyJSON(detail.sku_metadata_json)}</pre>
        </section>
      </div>

      {#if detail.state === 'pending'}
        <section
          class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="order-config-form"
        >
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Configure & Start
          </h2>
          <p class="mt-1 text-xs text-slate-500">
            Set posts/day, active hours window, and the account pool filter, then start the order.
            All four fields are required.
          </p>
          <div class="mt-4 grid gap-4 md:grid-cols-3">
            <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Posts per day
              <input
                type="number"
                min="1"
                bind:value={postsPerDay}
                class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                data-testid="cfg-posts-per-day"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Active hours start (0–23)
              <input
                type="number"
                min="0"
                max="23"
                bind:value={activeHoursStart}
                class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                data-testid="cfg-ahs"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Active hours end (0–23)
              <input
                type="number"
                min="0"
                max="23"
                bind:value={activeHoursEnd}
                class="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                data-testid="cfg-ahe"
              />
            </label>
          </div>
          <label class="mt-4 block text-xs font-medium text-slate-600">
            Account pool filter (JSON object)
            <textarea
              rows="6"
              bind:value={poolFilterText}
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-slate-500 focus:outline-none"
              class:border-red-400={!poolFilterLooksValid}
              data-testid="cfg-pool-filter"
            ></textarea>
            {#if !poolFilterLooksValid}
              <span class="mt-1 block text-red-600" data-testid="cfg-pool-filter-error">
                Must be valid JSON object (e.g. <code>{`{"min_warmup_days": 5}`}</code>)
              </span>
            {/if}
          </label>

          <div
            class="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
            data-testid="pool-preview-widget"
          >
            {#if previewError}
              <span class="text-red-700" data-testid="pool-preview-error">{previewError}</span>
            {:else if previewLoading && preview === null}
              <span class="text-slate-500" data-testid="pool-preview-loading">Previewing pool…</span>
            {:else if preview}
              <span data-testid="pool-preview-summary">
                <strong data-testid="pool-preview-count">{preview.matching_accounts_count}</strong>
                matching {preview.matching_accounts_count === 1 ? 'account' : 'accounts'}
                {#if preview.estimated_completion_days !== null && ppdValid}
                  , estimated
                  <strong data-testid="pool-preview-days">{preview.estimated_completion_days}</strong>
                  {preview.estimated_completion_days === 1 ? 'day' : 'days'}
                  at <strong>{ppdNum}</strong>/day
                {/if}
              </span>
              {#if previewLoading}
                <span class="ml-2 text-slate-400">refreshing…</span>
              {/if}
            {:else}
              <span class="text-slate-500">Edit the filter to preview matching accounts.</span>
            {/if}
          </div>
          {#if startError}
            <p
              role="alert"
              class="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
              data-testid="order-start-error"
            >
              {startError}
            </p>
          {/if}
          <div class="mt-4 flex justify-end">
            <button
              type="button"
              on:click={start}
              disabled={!canStart}
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="order-start-button"
            >
              {startPending ? 'Starting…' : 'Start order'}
            </button>
          </div>
        </section>
      {/if}

      {#if cancelDialogOpen && detail}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="cancel-dialog"
        >
          <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="cancel-dialog-title" class="text-lg font-semibold text-slate-900">
              Cancel order?
            </h2>
            <p class="mt-2 text-sm text-slate-600">
              {detail.sku_code} for <span class="font-mono">{detail.customer_email}</span>
              ({detail.posts_done}/{detail.posts_total} posts delivered).
            </p>

            {#if detail.state === 'pending'}
              <label
                class="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  bind:checked={cancelRefund}
                  class="mt-0.5"
                  data-testid="cancel-refund-checkbox"
                />
                <span>
                  Refund to balance?
                  <span class="block text-xs text-slate-500">
                    Credits the order's paid amount back to the customer's wallet.
                  </span>
                </span>
              </label>
            {:else}
              <p
                class="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
                data-testid="cancel-no-refund-warning"
              >
                No refund will be issued (post-activation policy). The order will stop and any
                already-posted reels will remain.
              </p>
            {/if}

            {#if actionError}
              <p
                role="alert"
                class="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
                data-testid="cancel-error"
              >
                {actionError}
              </p>
            {/if}

            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                on:click={closeCancel}
                disabled={cancelPending}
                class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                data-testid="cancel-dialog-dismiss"
              >
                Keep order
              </button>
              <button
                type="button"
                on:click={confirmCancel}
                disabled={cancelPending}
                class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="cancel-dialog-confirm"
              >
                {cancelPending ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </section>
</AdminGuard>
