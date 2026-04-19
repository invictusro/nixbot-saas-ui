<script lang="ts">
  import { Router, Route } from 'svelte-routing';
  import Home from './routes/Home.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import VerifyEmail from './routes/VerifyEmail.svelte';
  import ForgotPassword from './routes/ForgotPassword.svelte';
  import ResetPassword from './routes/ResetPassword.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import AccountDetail from './routes/AccountDetail.svelte';
  import Billing from './routes/Billing.svelte';
  import AdminCustomers from './routes/AdminCustomers.svelte';
  import AdminCustomerDetail from './routes/AdminCustomerDetail.svelte';
  import Nav from './components/Nav.svelte';
  import ImpersonationBanner from './components/ImpersonationBanner.svelte';

  export let url = '';
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
    <Route path="/dashboard" component={Dashboard} />
    <Route path="/billing" component={Billing} />
    <Route path="/accounts/:id" let:params>
      <AccountDetail id={params.id} />
    </Route>
    <Route path="/admin/customers" component={AdminCustomers} />
    <Route path="/admin/customers/:id" let:params>
      <AdminCustomerDetail id={params.id} />
    </Route>
  </main>
</Router>
