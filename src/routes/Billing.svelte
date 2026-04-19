<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { balanceStore, planStore } from '../lib/stores';
  import {
    accountsClient,
    billingClient,
    ApiError,
    type BalanceTransaction,
    type PaymentMethod,
  } from '../lib/api';
  import { getQueryParam } from '../lib/query';
  import DeleteConfirmModal from '../components/DeleteConfirmModal.svelte';

  const PAGE_SIZE = 25;
  const PRESET_TOPUPS = [2500, 5000, 10000, 25000];

  let loading = true;
  let loadError = '';
  let toast = '';

  let transactions: BalanceTransaction[] = [];
  let nextCursor: string | null = null;
  let historyBusy = false;
  let historyError = '';

  let paymentMethods: PaymentMethod[] = [];
  let cardsError = '';
  let defaultBusy = '';

  let topupAmount = 2500;
  let topupBusy = false;
  let topupError = '';

  let deleteTarget: PaymentMethod | null = null;
  let deleteBusy = false;
  let deleteError = '';

  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  $: balanceCents = $balanceStore ?? 0;
  $: planFeeCents = $planStore?.price_cents ?? 0;
  $: balanceLabel = $balanceStore === null ? '—' : formatMoney(balanceCents);
  $: lowBalance = $balanceStore !== null && planFeeCents > 0 && balanceCents < planFeeCents;
  $: hasMore = nextCursor !== null && nextCursor !== '';

  function formatMoney(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }

  function formatSignedDelta(t: BalanceTransaction): string {
    const sign = t.type === 'credit' ? '+' : '-';
    return `${sign}$${(t.amount_cents / 100).toFixed(2)}`;
  }

  function reasonLabel(reason: BalanceTransaction['reason']): string {
    switch (reason) {
      case 'stripe_topup':
        return 'Card top-up';
      case 'crypto_topup':
        return 'Crypto top-up';
      case 'admin_credit':
        return 'Admin credit';
      case 'admin_debit':
        return 'Admin debit';
      case 'plan_fee':
        return 'Plan fee';
      case 'account_creation':
        return 'Account creation';
      case 'refund':
        return 'Refund';
      default:
        return reason;
    }
  }

  function showToast(msg: string): void {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = '';
      toastTimer = null;
    }, 5000);
  }

  async function loadAll(): Promise<void> {
    try {
      const [summary, page, cards] = await Promise.all([
        accountsClient.summary(),
        billingClient.listTransactions({ limit: PAGE_SIZE }),
        billingClient.listPaymentMethods(),
      ]);
      balanceStore.set(summary.balance_cents);
      planStore.set(summary.plan);
      transactions = page.transactions;
      nextCursor = page.next_cursor ?? null;
      paymentMethods = cards;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load billing';
    } finally {
      loading = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (historyBusy || !hasMore || !nextCursor) return;
    historyBusy = true;
    historyError = '';
    try {
      const page = await billingClient.listTransactions({ limit: PAGE_SIZE, cursor: nextCursor });
      transactions = [...transactions, ...page.transactions];
      nextCursor = page.next_cursor ?? null;
    } catch (e) {
      historyError = e instanceof Error ? e.message : 'Failed to load more';
    } finally {
      historyBusy = false;
    }
  }

  async function startTopup(): Promise<void> {
    if (topupBusy) return;
    if (!Number.isFinite(topupAmount) || topupAmount < 100) {
      topupError = 'Minimum top-up is $1.00';
      return;
    }
    topupBusy = true;
    topupError = '';
    try {
      const session = await billingClient.createCheckoutSession(topupAmount);
      if (session.url) {
        window.location.assign(session.url);
        return;
      }
      topupError = 'Stripe did not return a redirect URL';
    } catch (e) {
      topupError =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Top-up failed';
    } finally {
      topupBusy = false;
    }
  }

  function openDelete(pm: PaymentMethod): void {
    deleteTarget = pm;
    deleteError = '';
  }

  function closeDelete(): void {
    if (deleteBusy) return;
    deleteTarget = null;
    deleteError = '';
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleteBusy) return;
    deleteBusy = true;
    deleteError = '';
    const id = deleteTarget.id;
    try {
      await billingClient.deletePaymentMethod(id);
      paymentMethods = paymentMethods.filter((p) => p.id !== id);
      deleteTarget = null;
      showToast('Card removed');
    } catch (e) {
      deleteError = e instanceof Error ? e.message : 'Delete failed';
    } finally {
      deleteBusy = false;
    }
  }

  async function makeDefault(pm: PaymentMethod): Promise<void> {
    if (defaultBusy || pm.is_default) return;
    defaultBusy = pm.id;
    cardsError = '';
    try {
      const updated = await billingClient.setDefaultPaymentMethod(pm.id);
      paymentMethods = paymentMethods.map((p) => ({
        ...p,
        is_default: p.id === updated.id,
      }));
      showToast('Default card updated');
    } catch (e) {
      cardsError = e instanceof Error ? e.message : 'Update failed';
    } finally {
      defaultBusy = '';
    }
  }

  function formatCardLabel(pm: PaymentMethod): string {
    const brand = pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1);
    const mm = String(pm.exp_month).padStart(2, '0');
    const yy = String(pm.exp_year).slice(-2);
    return `${brand} ···· ${pm.last4} · exp ${mm}/${yy}`;
  }

  onMount(() => {
    const topup = getQueryParam('topup');
    if (topup === 'success') showToast('Top-up successful — balance will update shortly.');
    else if (topup === 'cancelled') showToast('Top-up cancelled.');
    void loadAll();
  });

  onDestroy(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });
</script>

<section class="space-y-6">
  <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div>
      <h1 class="text-2xl font-semibold text-slate-900">Billing</h1>
      <p class="text-sm text-slate-500">Manage balance, payments, and history.</p>
    </div>
    <div class="text-right">
      <p class="text-xs uppercase tracking-wide text-slate-500">Current balance</p>
      <p class="text-3xl font-semibold text-slate-900" data-testid="balance">{balanceLabel}</p>
      {#if $planStore}
        <p class="text-xs text-slate-500">
          Plan fee {formatMoney($planStore.price_cents)}/mo
        </p>
      {/if}
    </div>
  </header>

  {#if toast}
    <div
      class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      role="status"
      data-testid="toast"
    >
      {toast}
    </div>
  {/if}

  {#if lowBalance}
    <div
      class="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="alert"
      data-testid="low-balance-banner"
    >
      Your balance ({formatMoney(balanceCents)}) is below your plan fee
      ({formatMoney(planFeeCents)}). Top up to avoid account suspension.
    </div>
  {/if}

  {#if loading}
    <p class="text-slate-500">Loading…</p>
  {:else if loadError}
    <p class="text-rose-600" role="alert">{loadError}</p>
  {:else}
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div class="lg:col-span-1 space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-base font-semibold text-slate-900">Top up</h2>
        <div class="flex flex-wrap gap-2">
          {#each PRESET_TOPUPS as preset}
            <button
              type="button"
              class="rounded-md border px-3 py-1.5 text-sm {topupAmount === preset
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'}"
              on:click={() => (topupAmount = preset)}
              data-testid="topup-preset-{preset}"
            >
              {formatMoney(preset)}
            </button>
          {/each}
        </div>
        <label class="block text-sm">
          <span class="text-slate-700">Amount (cents)</span>
          <input
            type="number"
            min="100"
            step="100"
            bind:value={topupAmount}
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-900 focus:outline-none"
            data-testid="topup-amount"
          />
        </label>
        <button
          type="button"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          on:click={startTopup}
          disabled={topupBusy}
          data-testid="topup-button"
        >
          {topupBusy ? 'Redirecting…' : 'Top up with card'}
        </button>
        {#if topupError}
          <p class="text-sm text-rose-600" role="alert">{topupError}</p>
        {/if}
        <p class="text-xs text-slate-500">
          Redirects to Stripe Checkout. A PDF invoice is emailed after success.
        </p>
      </div>

      <div class="lg:col-span-2 space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-slate-900">Saved cards</h2>
        </div>
        {#if paymentMethods.length === 0}
          <p class="text-sm text-slate-500">No saved cards yet. Top up once to save a card.</p>
        {:else}
          <ul class="divide-y divide-slate-200" data-testid="payment-methods">
            {#each paymentMethods as pm (pm.id)}
              <li class="flex items-center justify-between gap-3 py-3" data-testid="payment-method">
                <div class="min-w-0">
                  <p class="font-mono text-sm text-slate-900">{formatCardLabel(pm)}</p>
                  {#if pm.is_default}
                    <span class="mt-0.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      Default
                    </span>
                  {/if}
                </div>
                <div class="flex items-center gap-2">
                  {#if !pm.is_default}
                    <button
                      type="button"
                      class="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      on:click={() => makeDefault(pm)}
                      disabled={defaultBusy === pm.id}
                      data-testid="set-default"
                    >
                      {defaultBusy === pm.id ? '…' : 'Set default'}
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="rounded-md border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
                    on:click={() => openDelete(pm)}
                    data-testid="delete-card"
                  >
                    Delete
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        {#if cardsError}
          <p class="text-sm text-rose-600" role="alert">{cardsError}</p>
        {/if}
      </div>
    </div>

    <div class="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 class="text-base font-semibold text-slate-900">Transaction history</h2>
      {#if transactions.length === 0}
        <p class="text-sm text-slate-500">No transactions yet.</p>
      {:else}
        <table class="w-full text-sm" data-testid="transactions">
          <thead class="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="py-2">Date</th>
              <th class="py-2">Reason</th>
              <th class="py-2">Description</th>
              <th class="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            {#each transactions as t (t.id)}
              <tr data-testid="transaction-row">
                <td class="py-2 text-slate-700">{new Date(t.created_at).toLocaleString()}</td>
                <td class="py-2 text-slate-700">{reasonLabel(t.reason)}</td>
                <td class="py-2 text-slate-500">{t.description ?? ''}</td>
                <td
                  class="py-2 text-right font-mono {t.type === 'credit'
                    ? 'text-emerald-700'
                    : 'text-rose-700'}"
                >
                  {formatSignedDelta(t)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if historyError}
        <p class="text-sm text-rose-600" role="alert">{historyError}</p>
      {/if}
      {#if hasMore}
        <button
          type="button"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          on:click={loadMore}
          disabled={historyBusy}
          data-testid="load-more"
        >
          {historyBusy ? 'Loading…' : 'Load more'}
        </button>
      {/if}
    </div>
  {/if}
</section>

<DeleteConfirmModal
  open={deleteTarget !== null}
  username={deleteTarget ? `${deleteTarget.brand}-${deleteTarget.last4}` : undefined}
  busy={deleteBusy}
  error={deleteError}
  on:cancel={closeDelete}
  on:confirm={confirmDelete}
/>
