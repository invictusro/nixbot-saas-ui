<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { session } from '../stores/session';
  import {
    accountsStore,
    balanceStore,
    planStore,
    type AccountRecord,
  } from '../lib/stores';
  import { accountsClient } from '../lib/api';
  import { connectRealtime, type RealtimeHandle } from '../lib/sse';
  import AccountCard from '../components/AccountCard.svelte';

  let loading = true;
  let loadError = '';
  let handle: RealtimeHandle | null = null;

  $: accountList = Object.values($accountsStore).sort((a, b) =>
    (a.username ?? a.id).localeCompare(b.username ?? b.id),
  ) as AccountRecord[];

  $: visibleAccounts = accountList.filter((a) => a.status !== 'deleted');

  $: balanceLabel =
    $balanceStore === null ? '—' : `$${($balanceStore / 100).toFixed(2)}`;

  $: planLabel = $planStore
    ? `${$planStore.name} · $${($planStore.price_cents / 100).toFixed(2)}/mo`
    : '—';

  $: accountCap = $planStore?.max_accounts ?? null;

  onMount(async () => {
    try {
      const [summary, accounts] = await Promise.all([
        accountsClient.summary(),
        accountsClient.list(),
      ]);
      balanceStore.set(summary.balance_cents);
      planStore.set(summary.plan);
      const next: Record<string, AccountRecord> = {};
      for (const a of accounts) next[a.id] = a;
      accountsStore.set(next);
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load dashboard';
    } finally {
      loading = false;
    }

    handle = connectRealtime({
      endpoint: '/api/customer/events',
      async fetchSnapshot() {
        const [summary, accounts] = await Promise.all([
          accountsClient.summary(),
          accountsClient.list(),
        ]);
        const rec: Record<string, AccountRecord> = {};
        for (const a of accounts) rec[a.id] = a;
        return { accounts: rec as never, balance_cents: summary.balance_cents };
      },
    });
  });

  onDestroy(() => {
    handle?.close();
  });
</script>

<section class="space-y-6">
  <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div>
      <h1 class="text-2xl font-semibold text-slate-900">Dashboard</h1>
      {#if $session.user}
        <p class="text-sm text-slate-500">
          Signed in as <span class="font-mono">{$session.user.email}</span>
        </p>
      {/if}
    </div>
    <dl class="flex flex-wrap items-center gap-6 text-sm">
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Balance</dt>
        <dd class="text-lg font-semibold text-slate-900" data-testid="balance">
          {balanceLabel}
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Plan</dt>
        <dd class="text-lg font-semibold text-slate-900" data-testid="plan">
          {planLabel}
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-slate-500">Accounts</dt>
        <dd class="text-lg font-semibold text-slate-900" data-testid="account-count">
          {visibleAccounts.length}{accountCap !== null ? ` / ${accountCap}` : ''}
        </dd>
      </div>
    </dl>
  </header>

  {#if loading}
    <p class="text-slate-500">Loading…</p>
  {:else if loadError}
    <p class="text-rose-600" role="alert">{loadError}</p>
  {:else if visibleAccounts.length === 0}
    <p class="text-slate-500">No accounts yet. Add one to get started.</p>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="account-grid">
      {#each visibleAccounts as account (account.id)}
        <AccountCard {account} />
      {/each}
    </div>
  {/if}
</section>
