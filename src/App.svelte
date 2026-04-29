<script lang="ts">
  import { Router, Route } from 'svelte-routing';
  import { brand, applyBrandTheme } from './stores/brand';
  import Home from './routes/Home.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import VerifyEmail from './routes/VerifyEmail.svelte';
  import ForgotPassword from './routes/ForgotPassword.svelte';
  import ResetPassword from './routes/ResetPassword.svelte';
  import SetupPassword from './routes/SetupPassword.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import AccountDetail from './routes/AccountDetail.svelte';
  import Billing from './routes/Billing.svelte';
  import Orders from './routes/Orders.svelte';
  import OrderDetail from './routes/OrderDetail.svelte';
  import Subscriptions from './routes/Subscriptions.svelte';
  import SubscriptionDetail from './routes/SubscriptionDetail.svelte';
  import SubscriptionAccountDetail from './routes/SubscriptionAccountDetail.svelte';
  import AdminCustomers from './routes/AdminCustomers.svelte';
  import AdminCustomerDetail from './routes/AdminCustomerDetail.svelte';
  import AdminOrders from './routes/AdminOrders.svelte';
  import AdminOrderDetail from './routes/AdminOrderDetail.svelte';
  import AdminSubscriptions from './routes/AdminSubscriptions.svelte';
  import AdminSubscriptionDetail from './routes/AdminSubscriptionDetail.svelte';
  import AdminRevenue from './routes/AdminRevenue.svelte';
  import AdminCatalog from './routes/AdminCatalog.svelte';
  import Nav from './components/Nav.svelte';
  import ImpersonationBanner from './components/ImpersonationBanner.svelte';

  export let url = '';

  applyBrandTheme($brand);
</script>

<Router {url}>
  <ImpersonationBanner />
  <Nav />
  <main class="mx-auto max-w-5xl px-6 py-10">
    <Route path="/" component={Home} />
    <Route path="/login" component={Login} />
    <Route path="/signup" component={Signup} />
    <Route path="/verify-email" component={VerifyEmail} />
    <Route path="/forgot-password" component={ForgotPassword} />
    <Route path="/reset-password" component={ResetPassword} />
    <Route path="/setup-password" component={SetupPassword} />
    <Route path="/dashboard" component={Dashboard} />
    <Route path="/billing" component={Billing} />
    <Route path="/orders" component={Orders} />
    <Route path="/orders/:id" let:params>
      <OrderDetail id={params.id} />
    </Route>
    <Route path="/subscriptions" component={Subscriptions} />
    <Route path="/subscriptions/:id" let:params>
      <SubscriptionDetail id={params.id} />
    </Route>
    <Route path="/subscriptions/:id/accounts/:accountId" let:params>
      <SubscriptionAccountDetail id={params.id} accountId={params.accountId} />
    </Route>
    <Route path="/accounts/:id" let:params>
      <AccountDetail id={params.id} />
    </Route>
    <Route path="/admin/customers" component={AdminCustomers} />
    <Route path="/admin/customers/:id" let:params>
      <AdminCustomerDetail id={params.id} />
    </Route>
    <Route path="/admin/orders" component={AdminOrders} />
    <Route path="/admin/orders/:id" let:params>
      <AdminOrderDetail id={params.id} />
    </Route>
    <Route path="/admin/subscriptions" component={AdminSubscriptions} />
    <Route path="/admin/subscriptions/:id" let:params>
      <AdminSubscriptionDetail id={params.id} />
    </Route>
    <Route path="/admin/revenue" component={AdminRevenue} />
    <Route path="/admin/catalog" component={AdminCatalog} />
  </main>
</Router>
