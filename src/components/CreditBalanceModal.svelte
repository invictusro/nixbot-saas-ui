<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { AdminBalanceReason } from '../lib/api';

  export let email = '';
  export let pending = false;
  export let error = '';

  const dispatch = createEventDispatcher<{
    confirm: { type: 'credit' | 'debit'; amount_cents: number; reason: AdminBalanceReason; description?: string };
    cancel: void;
  }>();

  let type: 'credit' | 'debit' = 'credit';
  let amountDollars = '';
  let reason: AdminBalanceReason = 'admin_credit';
  let description = '';

  $: reasonOptions = (type === 'credit'
    ? (['admin_credit', 'crypto_topup', 'refund'] as AdminBalanceReason[])
    : (['admin_debit'] as AdminBalanceReason[]));

  $: if (!reasonOptions.includes(reason)) reason = reasonOptions[0];

  $: amountCents = Math.round(parseFloat(amountDollars || '0') * 100);
  $: canSubmit = amountCents > 0 && !pending;

  function submit(e: Event): void {
    e.preventDefault();
    if (!canSubmit) return;
    dispatch('confirm', {
      type,
      amount_cents: amountCents,
      reason,
      description: description.trim() || undefined,
    });
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="credit-modal-title"
  data-testid="credit-modal"
>
  <div class="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg">
    <form on:submit={submit} class="space-y-4 p-6">
      <div>
        <h2 id="credit-modal-title" class="text-lg font-semibold text-slate-900">
          Adjust balance
        </h2>
        <p class="text-sm text-slate-500">Target: <span class="font-mono">{email}</span></p>
      </div>

      <fieldset class="flex gap-4 text-sm">
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={type} value="credit" />
          Credit
        </label>
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={type} value="debit" />
          Debit
        </label>
      </fieldset>

      <label class="block text-sm">
        <span class="text-slate-700">Amount (USD)</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          bind:value={amountDollars}
          required
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-slate-500 focus:outline-none"
          data-testid="credit-amount"
        />
      </label>

      <label class="block text-sm">
        <span class="text-slate-700">Reason</span>
        <select
          bind:value={reason}
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-slate-500 focus:outline-none"
          data-testid="credit-reason"
        >
          {#each reasonOptions as r}
            <option value={r}>{r}</option>
          {/each}
        </select>
      </label>

      <label class="block text-sm">
        <span class="text-slate-700">Description</span>
        <textarea
          bind:value={description}
          rows="2"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-slate-500 focus:outline-none"
          data-testid="credit-description"
          placeholder="e.g. BTC tx abc123"
        ></textarea>
      </label>

      {#if error}
        <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      {/if}

      <div class="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          on:click={() => dispatch('cancel')}
          class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="credit-confirm"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Submitting…' : 'Apply'}
        </button>
      </div>
    </form>
  </div>
</div>
