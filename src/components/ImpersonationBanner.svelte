<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth } from '../lib/auth';
  import { session } from '../stores/session';

  let pending = false;
  let error = '';

  $: user = $session.user;
  $: active = !!user?.impersonated_by;

  async function exit(): Promise<void> {
    if (pending) return;
    pending = true;
    error = '';
    try {
      const admin = await auth.stopImpersonation();
      session.set({ user: admin });
      navigate('/admin/customers');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to exit impersonation.';
    } finally {
      pending = false;
    }
  }
</script>

{#if active}
  <div
    role="alert"
    data-testid="impersonation-banner"
    class="flex items-center justify-between gap-4 border-b border-amber-400 bg-amber-300 px-6 py-2 text-sm text-amber-950"
  >
    <div class="flex items-center gap-3">
      <span class="font-semibold">Impersonating {user?.email ?? user?.id ?? 'user'}</span>
      <Link
        to="/admin/audit-log"
        getProps={() => ({
          class: 'underline hover:text-amber-900',
          'data-testid': 'impersonation-audit-link',
        })}
      >
        View audit log
      </Link>
    </div>
    <div class="flex items-center gap-3">
      {#if error}
        <span class="text-red-800" role="status">{error}</span>
      {/if}
      <button
        type="button"
        on:click={exit}
        disabled={pending}
        data-testid="impersonation-exit"
        class="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  </div>
{/if}
