<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import {
    adminClient,
    ApiError,
    type AdminSubscriptionDetail,
    type AdminSubscriptionState,
    type IdleOperatorAccount,
  } from '../lib/api';

  export let id: string;

  let detail: AdminSubscriptionDetail | null = null;
  let loading = true;
  let loadError = '';

  let allocStartWarmup = false;
  let allocPending = false;
  let allocError = '';

  let idleAccounts: IdleOperatorAccount[] = [];
  let idleLoading = false;
  let idleError = '';
  let idleNicheFilter = '';
  let idleSearch = '';
  let selectedIds = new Set<string>();

  let createCount = 0;
  let createPending = false;
  let createError = '';

  let activatePending = false;
  let activateError = '';

  let pausePending = false;
  let resumePending = false;
  let actionError = '';

  let cancelDialogOpen = false;
  let cancelPending = false;

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
      detail = await adminClient.getSubscription(id);
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

  async function loadIdleAccounts(): Promise<void> {
    idleLoading = true;
    idleError = '';
    try {
      const page = await adminClient.listIdleOperatorAccounts(
        idleNicheFilter ? { niche: idleNicheFilter } : {},
      );
      idleAccounts = page.accounts;
      const stillIdle = new Set(idleAccounts.map((a) => a.id));
      selectedIds = new Set([...selectedIds].filter((id) => stillIdle.has(id)));
    } catch (e) {
      idleError = e instanceof Error ? e.message : 'Failed to load idle accounts';
    } finally {
      idleLoading = false;
    }
  }

  function toggleSelect(accountId: string): void {
    const next = new Set(selectedIds);
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      if (selectionAtCap) return;
      next.add(accountId);
    }
    selectedIds = next;
  }

  async function attachSelected(): Promise<void> {
    if (selectedIds.size === 0) {
      allocError = 'Select at least one idle account.';
      return;
    }
    allocPending = true;
    allocError = '';
    try {
      await adminClient.allocateSubscriptionAccounts(id, {
        account_ids: [...selectedIds],
        start_warmup: allocStartWarmup,
      });
      selectedIds = new Set();
      await Promise.all([load(), loadIdleAccounts()]);
    } catch (e) {
      allocError = e instanceof Error ? e.message : 'Failed to attach accounts';
    } finally {
      allocPending = false;
    }
  }

  async function createAccounts(): Promise<void> {
    if (createPending) return;
    if (!Number.isFinite(createCount) || createCount <= 0) {
      createError = 'Enter a positive count.';
      return;
    }
    createPending = true;
    createError = '';
    try {
      await adminClient.createSubscriptionAccounts(id, { count: Math.floor(createCount) });
      createCount = 0;
      await load();
    } catch (e) {
      createError = e instanceof Error ? e.message : 'Failed to create accounts';
    } finally {
      createPending = false;
    }
  }

  function badgeClass(state: AdminSubscriptionState | string): string {
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

  async function activate(): Promise<void> {
    if (!detail || activatePending) return;
    activatePending = true;
    activateError = '';
    try {
      await adminClient.activateSubscription(id);
      sessionStorage.setItem(
        'admin-subscriptions-toast',
        `Activated subscription ${detail.sku_code} for ${detail.customer_email}`,
      );
      navigate('/admin/subscriptions');
    } catch (e) {
      activateError = e instanceof Error ? e.message : 'Failed to activate subscription';
      activatePending = false;
    }
  }

  async function pause(): Promise<void> {
    if (!detail || pausePending) return;
    pausePending = true;
    actionError = '';
    try {
      await adminClient.pauseSubscription(id);
      await load();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to pause subscription';
    } finally {
      pausePending = false;
    }
  }

  async function resume(): Promise<void> {
    if (!detail || resumePending) return;
    resumePending = true;
    actionError = '';
    try {
      await adminClient.resumeSubscription(id);
      await load();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to resume subscription';
    } finally {
      resumePending = false;
    }
  }

  function openCancel(): void {
    actionError = '';
    cancelDialogOpen = true;
  }

  function closeCancel(): void {
    if (cancelPending) return;
    cancelDialogOpen = false;
  }

  async function confirmCancel(): Promise<void> {
    if (!detail || cancelPending) return;
    cancelPending = true;
    actionError = '';
    try {
      await adminClient.cancelSubscription(id);
      sessionStorage.setItem(
        'admin-subscriptions-toast',
        `Cancelled subscription ${detail.sku_code}`,
      );
      navigate('/admin/subscriptions');
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to cancel subscription';
      cancelPending = false;
      cancelDialogOpen = false;
    }
  }

  $: isPreActivation = detail?.state === 'pending_activation';
  $: isPostActivation =
    detail !== null && (detail.state === 'active' || detail.state === 'paused');
  $: requiredCount = detail?.required_account_count ?? null;
  $: realAssignments = (detail?.assignments ?? []).filter((a) => !a.pending_creation);
  $: pendingAssignments = (detail?.assignments ?? []).filter((a) => a.pending_creation);
  $: attachedCount = realAssignments.length;
  $: pendingCount = pendingAssignments.length;
  $: countSatisfied = requiredCount === null || attachedCount === requiredCount;
  $: canActivate =
    !activatePending && attachedCount > 0 && countSatisfied && pendingCount === 0;
  $: activateDisabledReason = (() => {
    if (activatePending) return 'Activating…';
    if (pendingCount > 0)
      return `Wait for ${pendingCount} placeholder account${pendingCount === 1 ? '' : 's'} to finish creating before activating.`;
    if (attachedCount === 0) return 'Attach at least one account before activating.';
    if (requiredCount !== null && attachedCount !== requiredCount)
      return `SKU requires exactly ${requiredCount} attached accounts; ${attachedCount} attached.`;
    return '';
  })();
  $: remainingSlots =
    requiredCount === null
      ? Infinity
      : Math.max(0, requiredCount - attachedCount - pendingCount);
  $: selectionAtCap = selectedIds.size >= remainingSlots;
  $: filteredIdleAccounts = filterIdleRows(idleAccounts, idleSearch);

  function filterIdleRows(rows: IdleOperatorAccount[], q: string): IdleOperatorAccount[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((a) => {
      if (a.username.toLowerCase().includes(needle)) return true;
      if (a.niche && a.niche.toLowerCase().includes(needle)) return true;
      return false;
    });
  }

  let idleLoaded = false;
  $: if (isPreActivation && !idleLoaded && !idleLoading) {
    idleLoaded = true;
    void loadIdleAccounts();
  }

  onMount(() => {
    void load();
  });
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-subscription-detail">
    <div class="flex items-center gap-3 text-sm text-slate-500">
      <Link
        to="/admin/subscriptions"
        getProps={() => ({ class: 'underline hover:text-slate-900' })}
      >
        ← Subscriptions
      </Link>
    </div>

    {#if loading}
      <p class="text-sm text-slate-500" data-testid="subscription-detail-loading">Loading…</p>
    {:else if loadError}
      <p
        role="alert"
        class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700"
        data-testid="subscription-detail-error"
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
            <span class={badgeClass(detail.state)} data-testid="subscription-state-badge">
              {detail.state}
            </span>
          </h1>
          <p class="text-sm text-slate-500">
            <span class="font-mono" data-testid="subscription-customer-email">
              {detail.customer_email}
            </span>
            · brand
            <span data-testid="subscription-source-brand">{detail.source_brand}</span>
            · accounts
            <span data-testid="subscription-accounts-count">
              {attachedCount}{requiredCount != null ? ` / ${requiredCount}` : ''}
            </span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2" data-testid="subscription-actions">
          {#if detail.state === 'active'}
            <button
              type="button"
              on:click={pause}
              disabled={pausePending}
              class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="subscription-pause-button"
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
              data-testid="subscription-resume-button"
            >
              {resumePending ? 'Resuming…' : 'Resume'}
            </button>
          {/if}
          {#if detail.state === 'pending_activation' || detail.state === 'active' || detail.state === 'paused'}
            <button
              type="button"
              on:click={openCancel}
              class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              data-testid="subscription-cancel-button"
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
          data-testid="subscription-action-error"
        >
          {actionError}
        </p>
      {/if}

      <div class="grid gap-4 md:grid-cols-2">
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Subscription
          </h2>
          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt class="text-slate-500">Created</dt>
            <dd class="font-mono text-slate-900">{fmtDate(detail.created_at)}</dd>
            <dt class="text-slate-500">Started at</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="subscription-started-at"
            >{fmtDate(detail.started_at)}</dd>
            <dt class="text-slate-500">Activated by</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="subscription-activated-by"
            >{detail.activated_by ?? '—'}</dd>
            <dt class="text-slate-500">Next renewal</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="subscription-next-renewal"
            >{fmtDate(detail.next_renewal_at)}</dd>
            <dt class="text-slate-500">Last renewed</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="subscription-last-renewed"
            >{fmtDate(detail.last_renewed_at)}</dd>
            <dt class="text-slate-500">Required accounts</dt>
            <dd
              class="font-mono text-slate-900"
              data-testid="subscription-required-count"
            >{requiredCount ?? '—'}</dd>
          </dl>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            SKU metadata
          </h2>
          <pre
            class="mt-3 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs text-slate-700"
            data-testid="subscription-sku-metadata"
          >{prettyJSON(detail.sku_metadata_json)}</pre>
        </section>
      </div>

      <section
        class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        data-testid="subscription-assignments"
      >
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Managed accounts
          <span class="ml-2 text-xs font-normal text-slate-500">
            ({attachedCount}{requiredCount != null ? ` / ${requiredCount}` : ''} attached{pendingCount > 0
              ? `, ${pendingCount} being created`
              : ''})
          </span>
        </h2>
        {#if detail.assignments.length === 0}
          <p
            class="mt-3 text-sm text-slate-500"
            data-testid="subscription-assignments-empty"
          >
            No accounts attached yet.
          </p>
        {:else}
          <table class="mt-3 min-w-full divide-y divide-slate-200 text-sm">
            <thead
              class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              <tr>
                <th class="px-3 py-2">Username</th>
                <th class="px-3 py-2">Status</th>
                <th class="px-3 py-2">Warmup days</th>
                <th class="px-3 py-2">Attached</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each detail.assignments as a (a.id)}
                <tr
                  data-testid="assignment-row"
                  data-account-id={a.account_id}
                  data-pending={a.pending_creation ? 'true' : 'false'}
                  class={a.pending_creation ? 'bg-amber-50' : ''}
                >
                  <td
                    class="px-3 py-2 font-mono text-slate-900"
                    data-testid="assignment-username"
                  >{a.pending_creation ? 'Being created…' : a.username}</td>
                  <td class="px-3 py-2 text-slate-700" data-testid="assignment-status">
                    {a.pending_creation ? 'pending' : a.status}
                  </td>
                  <td
                    class="px-3 py-2 text-slate-700"
                    data-testid="assignment-warmup-days"
                  >{a.pending_creation ? '—' : a.warmup_days}</td>
                  <td class="px-3 py-2 font-mono text-slate-500">{fmtDate(a.started_at)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      {#if isPreActivation}
        <section
          class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="subscription-create-section"
        >
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Create &amp; attach new accounts
          </h2>
          <p class="mt-1 text-xs text-slate-500">
            Enqueues N account-creation jobs and writes placeholder assignments so the
            customer dashboard shows them as <em>being created</em>. Successful creation
            backfills the assignment with the real account id; failed creation removes
            the placeholder and emits an admin alert in the audit log.
          </p>
          <div class="mt-3 flex flex-wrap items-end gap-3">
            <label class="text-xs font-medium text-slate-600">
              Count
              <input
                type="number"
                min="1"
                max="50"
                bind:value={createCount}
                placeholder={remainingSlots === Infinity ? 'N' : String(remainingSlots)}
                class="mt-1 w-24 rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
                data-testid="create-count-input"
              />
            </label>
            <button
              type="button"
              on:click={createAccounts}
              disabled={createPending || !createCount || createCount <= 0}
              class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="create-accounts-button"
            >
              {createPending ? 'Creating…' : `Create ${createCount || ''} new account${createCount === 1 ? '' : 's'}`.trim()}
            </button>
            {#if remainingSlots !== Infinity}
              <span class="text-xs text-slate-500" data-testid="create-remaining-hint">
                {remainingSlots} more needed for this SKU.
              </span>
            {/if}
          </div>
          {#if createError}
            <p
              role="alert"
              class="mt-2 text-xs text-red-700"
              data-testid="create-error"
            >
              {createError}
            </p>
          {/if}
        </section>

        <section
          class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="subscription-allocate-section"
        >
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Attach existing accounts
          </h2>
          <p class="mt-1 text-xs text-slate-500">
            Pick from operator-owned accounts that aren't currently attached to any other active
            subscription. Optional niche filter narrows the pool; the search box matches username
            or niche.
          </p>

          <div class="mt-3 grid gap-3 sm:grid-cols-3">
            <label class="block text-xs font-medium text-slate-600">
              Niche filter
              <input
                type="text"
                bind:value={idleNicheFilter}
                placeholder="e.g. fitness"
                class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
                data-testid="idle-niche-filter"
              />
            </label>
            <label class="block text-xs font-medium text-slate-600">
              Search
              <input
                type="text"
                bind:value={idleSearch}
                placeholder="username or niche"
                class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
                data-testid="idle-search"
              />
            </label>
            <div class="flex items-end">
              <button
                type="button"
                on:click={loadIdleAccounts}
                disabled={idleLoading}
                class="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="idle-reload-button"
              >
                {idleLoading ? 'Loading…' : 'Refresh idle list'}
              </button>
            </div>
          </div>

          {#if idleError}
            <p
              role="alert"
              class="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700"
              data-testid="idle-error"
            >
              {idleError}
            </p>
          {/if}

          <div class="mt-4 overflow-hidden rounded-md border border-slate-200">
            {#if idleLoading && idleAccounts.length === 0}
              <p class="p-3 text-xs text-slate-500" data-testid="idle-loading">Loading…</p>
            {:else if filteredIdleAccounts.length === 0}
              <p class="p-3 text-xs text-slate-500" data-testid="idle-empty">
                No idle operator accounts match the current filter.
              </p>
            {:else}
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead
                  class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  <tr>
                    <th class="w-10 px-3 py-2"></th>
                    <th class="px-3 py-2">Username</th>
                    <th class="px-3 py-2">Niche</th>
                    <th class="px-3 py-2">Status</th>
                    <th class="px-3 py-2">Warmup days</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  {#each filteredIdleAccounts as a (a.id)}
                    {@const checked = selectedIds.has(a.id)}
                    {@const disabled = !checked && selectionAtCap}
                    <tr
                      data-testid="idle-row"
                      data-account-id={a.id}
                      class={checked ? 'bg-slate-50' : ''}
                    >
                      <td class="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled || allocPending}
                          on:change={() => toggleSelect(a.id)}
                          data-testid="idle-checkbox"
                        />
                      </td>
                      <td
                        class="px-3 py-2 font-mono text-slate-900"
                        data-testid="idle-username"
                      >{a.username}</td>
                      <td class="px-3 py-2 text-slate-700" data-testid="idle-niche">
                        {a.niche ?? '—'}
                      </td>
                      <td class="px-3 py-2 text-slate-700">{a.status}</td>
                      <td class="px-3 py-2 text-slate-700">{a.warmup_days}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>

          <label class="mt-3 inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              bind:checked={allocStartWarmup}
              data-testid="alloc-start-warmup"
            />
            Start warmup on these accounts at activation
          </label>
          {#if allocError}
            <p
              role="alert"
              class="mt-2 text-xs text-red-700"
              data-testid="alloc-error"
            >
              {allocError}
            </p>
          {/if}
          {#if remainingSlots !== Infinity && selectionAtCap && requiredCount !== null}
            <p
              class="mt-2 text-xs text-slate-500"
              data-testid="idle-cap-notice"
            >
              You've selected the maximum {remainingSlots} more account{remainingSlots === 1
                ? ''
                : 's'} this SKU needs. Uncheck one to swap.
            </p>
          {/if}
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p class="text-xs text-slate-500" data-testid="alloc-progress">
              {attachedCount} attached{requiredCount != null
                ? ` of ${requiredCount} required`
                : ''} · {selectedIds.size} selected
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                on:click={attachSelected}
                disabled={allocPending || selectedIds.size === 0}
                class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="alloc-attach-button"
              >
                {allocPending
                  ? 'Attaching…'
                  : `Attach ${selectedIds.size || ''} selected`.trim()}
              </button>
              <button
                type="button"
                on:click={activate}
                disabled={!canActivate}
                title={activateDisabledReason}
                class="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="subscription-activate-button"
              >
                {activatePending ? 'Activating…' : 'Activate subscription'}
              </button>
            </div>
          </div>
          {#if !countSatisfied && requiredCount !== null}
            <p
              class="mt-2 text-xs text-amber-700"
              data-testid="activate-count-warning"
            >
              SKU requires exactly {requiredCount} attached accounts to activate.
            </p>
          {/if}
          {#if activateError}
            <p
              role="alert"
              class="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700"
              data-testid="activate-error"
            >
              {activateError}
            </p>
          {/if}
        </section>
      {/if}

      {#if isPostActivation}
        <section
          class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="subscription-manage-section"
        >
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Manage accounts
          </h2>
          <p class="mt-1 text-xs text-slate-500">
            Add replacement accounts to the managed pool, or detach a banned account. Detach
            tooling is not yet wired (TBD per future task).
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled
              class="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
              data-testid="subscription-add-account-button"
              title="Wired in a follow-up task"
            >
              Add account
            </button>
            <button
              type="button"
              disabled
              class="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
              data-testid="subscription-detach-account-button"
              title="Wired in a follow-up task"
            >
              Detach account
            </button>
          </div>
        </section>
      {/if}

      {#if cancelDialogOpen && detail}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sub-cancel-dialog-title"
          class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="cancel-dialog"
        >
          <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="sub-cancel-dialog-title" class="text-lg font-semibold text-slate-900">
              Cancel subscription?
            </h2>
            <p class="mt-2 text-sm text-slate-600">
              {detail.sku_code} for <span class="font-mono">{detail.customer_email}</span>
              ({attachedCount}{requiredCount != null ? `/${requiredCount}` : ''} accounts attached).
            </p>
            {#if detail.state === 'pending_activation'}
              <p
                class="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
              >
                Pre-activation cancel will refund the customer's balance via the engine.
              </p>
            {:else}
              <p
                class="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
                data-testid="cancel-end-of-cycle-notice"
              >
                The subscription will move to <code>pending_cancellation</code>. It will continue
                running and end at <span
                  class="font-mono"
                  data-testid="cancel-end-date"
                >{fmtDate(detail.next_renewal_at)}</span>
                — no refund will be issued for the current cycle. Attached accounts remain assigned
                until then, then return to the idle pool.
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
                Keep subscription
              </button>
              <button
                type="button"
                on:click={confirmCancel}
                disabled={cancelPending}
                class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="cancel-dialog-confirm"
              >
                {cancelPending ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </section>
</AdminGuard>
