<script lang="ts">
  import { onMount } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import AdminGuard from '../components/AdminGuard.svelte';
  import CreditBalanceModal from '../components/CreditBalanceModal.svelte';
  import { adminClient, type AdminCustomerDetail } from '../lib/api';
  import { session } from '../stores/session';

  export let id: string;

  let detail: AdminCustomerDetail | null = null;
  let loading = true;
  let loadError = '';

  let creditOpen = false;
  let creditPending = false;
  let creditError = '';

  let impersonatePending = false;
  let impersonateError = '';

  let toast = '';

  function showToast(msg: string): void {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = '';
    }, 4000);
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      detail = await adminClient.getCustomer(id);
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load customer';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  async function onCreditConfirm(
    e: CustomEvent<{
      type: 'credit' | 'debit';
      amount_cents: number;
      reason: 'crypto_topup' | 'admin_credit' | 'admin_debit' | 'refund';
      description?: string;
    }>,
  ): Promise<void> {
    creditPending = true;
    creditError = '';
    try {
      await adminClient.adjustBalance(id, e.detail);
      creditOpen = false;
      showToast(`${e.detail.type === 'credit' ? 'Credited' : 'Debited'} ${dollars(e.detail.amount_cents)}`);
      await load();
    } catch (err) {
      creditError = err instanceof Error ? err.message : 'Failed to adjust balance';
    } finally {
      creditPending = false;
    }
  }

  async function impersonate(): Promise<void> {
    if (impersonatePending) return;
    impersonatePending = true;
    impersonateError = '';
    try {
      const user = await adminClient.impersonate(id, { email: detail?.email });
      session.set({ user });
      navigate('/dashboard');
    } catch (err) {
      impersonateError = err instanceof Error ? err.message : 'Failed to impersonate';
    } finally {
      impersonatePending = false;
    }
  }
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-customer-detail">
    <div class="flex items-center gap-3 text-sm text-slate-500">
      <Link to="/admin/customers" getProps={() => ({ class: 'underline hover:text-slate-900' })}>
        ← Customers
      </Link>
    </div>

    {#if loading}
      <p class="text-sm text-slate-500">Loading…</p>
    {:else if loadError}
      <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </p>
    {:else if detail}
      <header class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">{detail.email}</h1>
          <p class="text-sm text-slate-500">
            {detail.plan_name ?? detail.plan_id} ·
            Balance {dollars(detail.balance_cents)} ·
            {detail.account_count} accounts
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            on:click={() => {
              creditError = '';
              creditOpen = true;
            }}
            data-testid="admin-credit-button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 hover:bg-slate-50"
          >
            Credit balance
          </button>
          <button
            type="button"
            on:click={impersonate}
            disabled={impersonatePending}
            data-testid="admin-impersonate-button"
            class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {impersonatePending ? 'Switching…' : 'Impersonate'}
          </button>
        </div>
      </header>

      {#if impersonateError}
        <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {impersonateError}
        </p>
      {/if}

      {#if toast}
        <p role="status" data-testid="admin-toast" class="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {toast}
        </p>
      {/if}

      <div class="grid gap-4 md:grid-cols-2">
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Accounts</h2>
          {#if detail.accounts && detail.accounts.length}
            <ul class="mt-3 space-y-1 text-sm">
              {#each detail.accounts as a (a.id)}
                <li class="flex items-center justify-between">
                  <span class="font-mono">@{a.username ?? a.id}</span>
                  <span class="text-xs text-slate-500">{a.status}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-2 text-sm text-slate-500">No accounts.</p>
          {/if}
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent transactions</h2>
          {#if detail.transactions && detail.transactions.length}
            <ul class="mt-3 space-y-1 text-sm">
              {#each detail.transactions as t (t.id)}
                <li class="flex items-center justify-between">
                  <span class="text-slate-700">{t.reason}</span>
                  <span class="font-mono text-slate-900">
                    {t.type === 'credit' ? '+' : '−'}{dollars(t.amount_cents)}
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-2 text-sm text-slate-500">No transactions.</p>
          {/if}
        </section>
      </div>

      {#if detail.audit && detail.audit.length}
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
          <ul class="mt-3 divide-y divide-slate-100 text-sm">
            {#each detail.audit as row (row.id)}
              <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                <span class="text-slate-700">{row.action}</span>
                <span class="text-xs text-slate-500">{row.created_at}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </section>

  {#if creditOpen && detail}
    <CreditBalanceModal
      email={detail.email}
      pending={creditPending}
      error={creditError}
      on:confirm={onCreditConfirm}
      on:cancel={() => (creditOpen = false)}
    />
  {/if}
</AdminGuard>
