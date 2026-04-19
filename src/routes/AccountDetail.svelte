<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { navigate } from 'svelte-routing';
  import {
    accountsClient,
    ApiError,
    type AccountDetail,
    type AccountSettings,
    type TaskHistoryEntry,
    type WarmupPreset,
    type WarmupSettings,
    type PostingSettings,
  } from '../lib/api';
  import { accountsStore, type AccountStatus } from '../lib/stores';
  import StatusBadge from '../components/StatusBadge.svelte';
  import DeleteConfirmModal from '../components/DeleteConfirmModal.svelte';

  export let id = '';

  let detail: AccountDetail | null = null;
  let loading = true;
  let loadError = '';

  let showAdvanced = false;
  let selectedPreset: WarmupPreset = 'normal';
  let warmupDraft: WarmupSettings = {};
  let postingDraft: PostingSettings = {};
  let savingSettings = false;
  let settingsMessage = '';
  let settingsError = '';

  let actionBusy = '';
  let actionError = '';

  let history: TaskHistoryEntry[] = [];
  let historyLoading = false;
  let historyError = '';
  let historyCursor: string | null = null;
  let historyPageSize = 25;
  let historyExhausted = false;

  let deleteOpen = false;
  let deleteBusy = false;
  let deleteError = '';

  function applyDetail(d: AccountDetail) {
    detail = d;
    const preset = d.settings.warmup.preset;
    selectedPreset = preset ?? 'normal';
    warmupDraft = { ...d.settings.warmup };
    postingDraft = { ...(d.settings.posting ?? {}) };
    accountsStore.update((s) => ({
      ...s,
      [d.id]: {
        ...(s[d.id] ?? { id: d.id }),
        id: d.id,
        status: d.status,
        ...(d.username !== undefined ? { username: d.username } : {}),
        ...(d.last_action_at !== undefined ? { last_action_at: d.last_action_at } : {}),
      },
    }));
  }

  async function loadDetail() {
    loading = true;
    loadError = '';
    try {
      const d = await accountsClient.get(id);
      applyDetail(d);
    } catch (e) {
      loadError =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load account';
    } finally {
      loading = false;
    }
  }

  async function loadHistory(reset = false) {
    if (historyLoading) return;
    if (reset) {
      history = [];
      historyCursor = null;
      historyExhausted = false;
    }
    historyLoading = true;
    historyError = '';
    try {
      const page = await accountsClient.history(id, {
        limit: historyPageSize,
        cursor: historyCursor,
      });
      history = [...history, ...page.tasks];
      historyCursor = page.next_cursor ?? null;
      if (!historyCursor || page.tasks.length === 0) historyExhausted = true;
    } catch (e) {
      historyError = e instanceof Error ? e.message : 'Failed to load history';
    } finally {
      historyLoading = false;
    }
  }

  function applyPresetToDraft(p: WarmupPreset) {
    warmupDraft = { ...warmupDraft, preset: p };
  }

  async function saveSettings() {
    if (!detail) return;
    savingSettings = true;
    settingsMessage = '';
    settingsError = '';
    try {
      const payload: AccountSettings = {
        warmup: { ...warmupDraft, preset: selectedPreset },
        posting: postingDraft,
      };
      const updated = await accountsClient.updateSettings(id, payload);
      applyDetail(updated);
      settingsMessage = 'Settings saved';
    } catch (e) {
      settingsError =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to save';
    } finally {
      savingSettings = false;
    }
  }

  async function doStartWarmup() {
    actionBusy = 'warmup';
    actionError = '';
    try {
      const updated = await accountsClient.startWarmup(id);
      if (detail) {
        detail = { ...detail, ...updated };
      }
      accountsStore.update((s) => ({
        ...s,
        [id]: { ...(s[id] ?? { id }), ...updated },
      }));
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to start warmup';
    } finally {
      actionBusy = '';
    }
  }

  async function doPauseResume() {
    if (!detail) return;
    actionBusy = 'pause';
    actionError = '';
    const paused = detail.status === 'paused';
    try {
      const updated = paused
        ? await accountsClient.resume(id)
        : await accountsClient.pause(id);
      if (detail) detail = { ...detail, ...updated };
      accountsStore.update((s) => ({
        ...s,
        [id]: { ...(s[id] ?? { id }), ...updated },
      }));
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Failed to toggle pause';
    } finally {
      actionBusy = '';
    }
  }

  async function doDelete() {
    deleteBusy = true;
    deleteError = '';
    try {
      await accountsClient.remove(id);
      accountsStore.update((s) => {
        const prev = s[id];
        if (!prev) return s;
        return { ...s, [id]: { ...prev, status: 'deleted' as AccountStatus } };
      });
      deleteOpen = false;
      navigate('/dashboard');
    } catch (e) {
      deleteError = e instanceof Error ? e.message : 'Failed to delete';
    } finally {
      deleteBusy = false;
    }
  }

  function formatTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  onMount(() => {
    if (!id) {
      loadError = 'No account id';
      loading = false;
      return;
    }
    loadDetail();
    loadHistory(true);
  });

  onDestroy(() => {
    // no-op; single-route lifecycle
  });

  $: canStartWarmup = detail?.status === 'ready';
  $: pauseLabel = detail?.status === 'paused' ? 'Resume' : 'Pause';
  $: canPauseToggle =
    detail != null &&
    (detail.status === 'paused' ||
      detail.status === 'active' ||
      detail.status === 'warming' ||
      detail.status === 'ready');
  $: canDelete =
    detail != null && detail.status !== 'deleted' && !deleteBusy;
</script>

<section class="space-y-6" data-testid="account-detail">
  <header class="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div class="min-w-0">
      <button
        type="button"
        class="mb-2 text-xs text-slate-500 hover:text-slate-700"
        on:click={() => navigate('/dashboard')}
      >
        ← Back to dashboard
      </button>
      <h1 class="truncate text-2xl font-semibold text-slate-900">
        @{detail?.username ?? id}
      </h1>
      {#if detail}
        <p class="mt-1 text-xs text-slate-500">
          Created {formatTime(detail.created_at)}
          {#if detail.warmup_started_at}
            · Warmup started {formatTime(detail.warmup_started_at)}
          {/if}
          {#if detail.phone_id}
            · Phone {detail.phone_id}
          {/if}
        </p>
        {#if detail.error_message}
          <p class="mt-2 text-sm text-rose-600" role="alert">{detail.error_message}</p>
        {/if}
      {/if}
    </div>
    {#if detail}
      <StatusBadge status={detail.status} />
    {/if}
  </header>

  {#if loading}
    <p class="text-slate-500">Loading…</p>
  {:else if loadError}
    <p class="text-rose-600" role="alert">{loadError}</p>
  {:else if detail}
    <div class="flex flex-wrap gap-2" data-testid="actions">
      <button
        type="button"
        class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        on:click={doStartWarmup}
        disabled={!canStartWarmup || actionBusy !== ''}
        data-testid="start-warmup"
      >
        {actionBusy === 'warmup' ? 'Starting…' : 'Start warmup'}
      </button>
      <button
        type="button"
        class="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        on:click={doPauseResume}
        disabled={!canPauseToggle || actionBusy !== ''}
        data-testid="pause-toggle"
      >
        {actionBusy === 'pause' ? 'Updating…' : pauseLabel}
      </button>
      <button
        type="button"
        class="rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        on:click={() => (deleteOpen = true)}
        disabled={!canDelete}
        data-testid="delete"
      >
        Delete…
      </button>
      {#if actionError}
        <span class="ml-2 self-center text-sm text-rose-600" role="alert">{actionError}</span>
      {/if}
    </div>

    <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-slate-900">Settings</h2>
        <label class="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            bind:checked={showAdvanced}
            data-testid="advanced-toggle"
          />
          Advanced
        </label>
      </div>

      <div class="mt-4">
        <fieldset data-testid="preset-selector" class="flex flex-wrap gap-2">
          <legend class="mb-2 block text-sm text-slate-700">Warmup preset</legend>
          {#each ['conservative', 'normal', 'aggressive'] as preset}
            <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              <input
                type="radio"
                name="preset"
                value={preset}
                bind:group={selectedPreset}
                on:change={() => applyPresetToDraft(preset)}
                data-testid={`preset-${preset}`}
              />
              <span class="capitalize">{preset}</span>
            </label>
          {/each}
        </fieldset>
      </div>

      {#if showAdvanced}
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="advanced-fields">
          <label class="text-sm text-slate-700">
            Daily follows
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.daily_follows}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Daily unfollows
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.daily_unfollows}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Daily likes
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.daily_likes}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Daily comments
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.daily_comments}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Daily story views
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.daily_story_views}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Daily DMs
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.daily_dms}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Session min (min)
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.session_min_minutes}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Session max (min)
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.session_max_minutes}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Sessions per day
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.sessions_per_day}
              min="0"
            />
          </label>
          <label class="text-sm text-slate-700">
            Active hours start
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.active_hours_start}
              min="0"
              max="23"
            />
          </label>
          <label class="text-sm text-slate-700">
            Active hours end
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.active_hours_end}
              min="0"
              max="23"
            />
          </label>
          <label class="text-sm text-slate-700">
            Jitter %
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.jitter_percent}
              min="0"
              max="100"
            />
          </label>
          <label class="text-sm text-slate-700">
            Ramp-up days
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              bind:value={warmupDraft.ramp_up_days}
              min="0"
            />
          </label>
        </div>
      {/if}

      <div class="mt-5 flex items-center gap-3">
        <button
          type="button"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          on:click={saveSettings}
          disabled={savingSettings}
          data-testid="save-settings"
        >
          {savingSettings ? 'Saving…' : 'Save settings'}
        </button>
        {#if settingsMessage}
          <span class="text-sm text-emerald-700" data-testid="settings-message">{settingsMessage}</span>
        {/if}
        {#if settingsError}
          <span class="text-sm text-rose-600" role="alert">{settingsError}</span>
        {/if}
      </div>
    </section>

    <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900">Recent tasks</h2>
        <button
          type="button"
          class="text-xs text-slate-500 hover:text-slate-700"
          on:click={() => loadHistory(true)}
          disabled={historyLoading}
        >
          Refresh
        </button>
      </div>
      {#if historyError}
        <p class="mt-3 text-sm text-rose-600" role="alert">{historyError}</p>
      {/if}
      {#if history.length === 0 && !historyLoading}
        <p class="mt-3 text-sm text-slate-500">No tasks yet.</p>
      {:else}
        <ul class="mt-3 divide-y divide-slate-200" data-testid="history-list">
          {#each history as task (task.id)}
            <li class="flex flex-wrap items-center justify-between gap-2 py-2">
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-800">{task.kind}</p>
                <p class="text-xs text-slate-500">
                  {formatTime(task.started_at)}
                  {#if task.finished_at}
                    → {formatTime(task.finished_at)}
                  {/if}
                </p>
                {#if task.detail}
                  <p class="mt-0.5 text-xs text-slate-500">{task.detail}</p>
                {/if}
              </div>
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                class:bg-emerald-100={task.status === 'success'}
                class:text-emerald-700={task.status === 'success'}
                class:bg-rose-100={task.status === 'failure'}
                class:text-rose-700={task.status === 'failure'}
                class:bg-slate-100={task.status === 'skipped' || task.status === 'running'}
                class:text-slate-700={task.status === 'skipped' || task.status === 'running'}
                data-testid="history-status"
              >
                {task.status}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="mt-4 flex items-center gap-3">
        <button
          type="button"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          on:click={() => loadHistory(false)}
          disabled={historyLoading || historyExhausted}
          data-testid="history-load-more"
        >
          {historyLoading ? 'Loading…' : historyExhausted ? 'End of history' : 'Load more'}
        </button>
      </div>
    </section>
  {/if}

  <DeleteConfirmModal
    open={deleteOpen}
    username={detail?.username}
    busy={deleteBusy}
    error={deleteError}
    on:cancel={() => (deleteOpen = false)}
    on:confirm={doDelete}
  />
</section>
