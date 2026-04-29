<script lang="ts">
  import { onMount } from 'svelte';
  import { Link } from 'svelte-routing';
  import { session } from '../stores/session';
  import { brand } from '../stores/brand';
  import { brandCopy } from '../lib/copy';
  import { customerOrdersClient, customerSubscriptionsClient } from '../lib/api';

  $: isAdmin = !!$session.user?.is_admin;
  $: isCustomer = !!$session.user && !$session.user.is_admin;

  let hasOrders = false;
  let hasSubscriptions = false;
  let lastChecked: string | null = null;

  async function refreshFlags(uid: string): Promise<void> {
    if (lastChecked === uid) return;
    lastChecked = uid;
    try {
      const rows = await customerOrdersClient.list();
      hasOrders = rows.length > 0;
    } catch {
      hasOrders = false;
    }
    try {
      const subs = await customerSubscriptionsClient.list();
      hasSubscriptions = subs.length > 0;
    } catch {
      hasSubscriptions = false;
    }
  }

  $: if (isCustomer && $session.user) {
    void refreshFlags($session.user.id);
  } else if (!isCustomer) {
    hasOrders = false;
    hasSubscriptions = false;
    lastChecked = null;
  }

  onMount(() => {
    if (isCustomer && $session.user) void refreshFlags($session.user.id);
  });
</script>

<nav class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
    <Link
      to="/"
      getProps={() => ({
        class: 'flex items-center gap-2 text-lg font-semibold text-slate-900',
        'data-testid': 'brand-link',
      })}
    >
      <img
        src={$brand.logoPath}
        alt="{$brand.name} logo"
        class="h-7 w-auto"
        data-testid="brand-logo"
      />
      <span data-testid="brand-name">{brandCopy($brand, 'appName', $brand.name)}</span>
    </Link>
    <div class="flex items-center gap-4 text-sm text-slate-600">
      <Link to="/dashboard" getProps={() => ({ class: 'hover:text-slate-900' })}>
        {brandCopy($brand, 'navDashboard')}
      </Link>
      <Link to="/billing" getProps={() => ({ class: 'hover:text-slate-900' })}>
        {brandCopy($brand, 'navBilling')}
      </Link>
      {#if isCustomer && hasOrders}
        <Link
          to="/orders"
          getProps={() => ({
            class: 'hover:text-slate-900',
            'data-testid': 'customer-orders-nav-link',
          })}
        >
          Orders
        </Link>
      {/if}
      {#if isCustomer && hasSubscriptions}
        <Link
          to="/subscriptions"
          getProps={() => ({
            class: 'hover:text-slate-900',
            'data-testid': 'customer-subscriptions-nav-link',
          })}
        >
          Subscriptions
        </Link>
      {/if}
      {#if isAdmin}
        <Link
          to="/admin/customers"
          getProps={() => ({
            class: 'font-medium text-amber-700 hover:text-amber-900',
            'data-testid': 'admin-nav-link',
          })}
        >
          {brandCopy($brand, 'navCustomers')}
        </Link>
        <Link
          to="/admin/orders"
          getProps={() => ({
            class: 'font-medium text-amber-700 hover:text-amber-900',
            'data-testid': 'admin-orders-nav-link',
          })}
        >
          Orders
        </Link>
        <Link
          to="/admin/subscriptions"
          getProps={() => ({
            class: 'font-medium text-amber-700 hover:text-amber-900',
            'data-testid': 'admin-subscriptions-nav-link',
          })}
        >
          Subscriptions
        </Link>
        <Link
          to="/admin/revenue"
          getProps={() => ({
            class: 'font-medium text-amber-700 hover:text-amber-900',
            'data-testid': 'admin-revenue-nav-link',
          })}
        >
          Revenue
        </Link>
        <Link
          to="/admin/catalog"
          getProps={() => ({
            class: 'font-medium text-amber-700 hover:text-amber-900',
            'data-testid': 'admin-catalog-nav-link',
          })}
        >
          Catalog
        </Link>
      {/if}
      <Link to="/login" getProps={() => ({ class: 'hover:text-slate-900' })}>
        {brandCopy($brand, 'navLogin')}
      </Link>
      <Link
        to="/signup"
        getProps={() => ({
          class:
            'rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700',
        })}
      >
        {brandCopy($brand, 'navSignup')}
      </Link>
    </div>
  </div>
</nav>
