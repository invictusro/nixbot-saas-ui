<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let open = false;
  export let username: string | undefined = undefined;
  export let busy = false;
  export let error = '';

  const dispatch = createEventDispatcher<{ confirm: void; cancel: void }>();

  let typed = '';
  $: target = username ?? 'delete';
  $: confirmEnabled = !busy && typed === target;

  function onCancel() {
    if (busy) return;
    typed = '';
    dispatch('cancel');
  }

  function onConfirm() {
    if (!confirmEnabled) return;
    dispatch('confirm');
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-modal-title"
    data-testid="delete-modal"
  >
    <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
      <h2 id="delete-modal-title" class="text-lg font-semibold text-slate-900">
        Delete account?
      </h2>
      <p class="mt-2 text-sm text-slate-600">
        Soft-deletes <span class="font-mono">@{target}</span>. It will appear in the Deleted tab
        for 30 days before permanent removal. Automation stops immediately.
      </p>
      <label class="mt-4 block text-sm">
        <span class="text-slate-700">Type <span class="font-mono">{target}</span> to confirm</span>
        <input
          type="text"
          bind:value={typed}
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-rose-500 focus:outline-none"
          autocomplete="off"
          data-testid="delete-confirm-input"
          disabled={busy}
        />
      </label>
      {#if error}
        <p class="mt-3 text-sm text-rose-600" role="alert">{error}</p>
      {/if}
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          on:click={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          on:click={onConfirm}
          disabled={!confirmEnabled}
          data-testid="delete-confirm-button"
        >
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </div>
  </div>
{/if}
