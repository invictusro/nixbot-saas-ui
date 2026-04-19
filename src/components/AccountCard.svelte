<script lang="ts">
  import { Link } from 'svelte-routing';
  import StatusBadge from './StatusBadge.svelte';
  import type { AccountRecord } from '../lib/stores';
  import { accountsStore, type AccountStatus } from '../lib/stores';
  import { accountsClient } from '../lib/api';

  export let account: AccountRecord;

  let busy = false;
  let error = '';

  const RUNNING: AccountStatus[] = ['ready', 'active', 'warming'];
  $: paused = account.status === 'paused';
  $: canToggle = paused || (RUNNING as readonly string[]).includes(account.status);

  function formatRelative(iso: string | null | undefined): string {
    if (!iso) return 'No activity yet';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return 'No activity yet';
    const diff = Date.now() - t;
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    error = '';
    const previous = account.status;
    const next: AccountStatus = paused ? 'active' : 'paused';

    accountsStore.update((s) => ({
      ...s,
      [account.id]: { ...(s[account.id] ?? account), status: next },
    }));

    try {
      const updated = paused
        ? await accountsClient.resume(account.id)
        : await accountsClient.pause(account.id);
      accountsStore.update((s) => ({
        ...s,
        [account.id]: { ...(s[account.id] ?? account), ...updated },
      }));
    } catch (e) {
      accountsStore.update((s) => ({
        ...s,
        [account.id]: { ...(s[account.id] ?? account), status: previous },
      }));
      error = e instanceof Error ? e.message : 'Failed to update';
    } finally {
      busy = false;
    }
  }
</script>

<article
  class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
  data-testid="account-card"
  data-account-id={account.id}
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <Link
        to={`/accounts/${encodeURIComponent(account.id)}`}
        class="truncate font-mono text-sm font-medium text-slate-900 hover:underline"
        data-testid="account-link"
      >
        @{account.username ?? account.id}
      </Link>
      <p class="mt-0.5 text-xs text-slate-500" data-testid="last-action">
        Last action · {formatRelative(account.last_action_at)}
      </p>
    </div>
    <StatusBadge status={account.status} />
  </div>

  <div class="flex items-center justify-between">
    <button
      type="button"
      class="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      on:click={toggle}
      disabled={busy || !canToggle}
      data-testid="pause-toggle"
    >
      {paused ? 'Resume' : 'Pause'}
    </button>
    {#if error}
      <span class="text-xs text-rose-600" role="alert">{error}</span>
    {/if}
  </div>
</article>
