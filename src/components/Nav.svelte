<script lang="ts">
  import { Link } from 'svelte-routing';
  import { session } from '../stores/session';

  $: isAdmin = !!$session.user?.is_admin;
</script>

<nav class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
    <Link to="/" getProps={() => ({ class: 'text-lg font-semibold text-slate-900' })}>
      nixbot
    </Link>
    <div class="flex items-center gap-4 text-sm text-slate-600">
      <Link to="/dashboard" getProps={() => ({ class: 'hover:text-slate-900' })}>Dashboard</Link>
      <Link to="/billing" getProps={() => ({ class: 'hover:text-slate-900' })}>Billing</Link>
      {#if isAdmin}
        <Link
          to="/admin/customers"
          getProps={() => ({
            class: 'font-medium text-amber-700 hover:text-amber-900',
            'data-testid': 'admin-nav-link',
          })}
        >
          Customers
        </Link>
      {/if}
      <Link to="/login" getProps={() => ({ class: 'hover:text-slate-900' })}>Login</Link>
      <Link to="/signup" getProps={() => ({ class: 'rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700' })}>Sign up</Link>
    </div>
  </div>
</nav>
