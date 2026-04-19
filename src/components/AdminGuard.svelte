<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '../stores/session';
  import { auth } from '../lib/auth';
  import NotFound from '../routes/NotFound.svelte';

  let resolved = false;

  $: user = $session.user;
  $: admin = !!user?.is_admin;

  onMount(async () => {
    if (!user) {
      try {
        const me = await auth.me();
        session.set({ user: me });
      } catch {
        session.set({ user: null });
      }
    }
    resolved = true;
  });
</script>

{#if !resolved}
  <p class="text-sm text-slate-500" data-testid="admin-guard-loading">Loading…</p>
{:else if admin}
  <slot />
{:else}
  <NotFound />
{/if}
