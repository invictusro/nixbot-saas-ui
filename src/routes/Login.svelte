<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth, AuthError } from '../lib/auth';
  import { session } from '../stores/session';

  let email = '';
  let password = '';
  let error = '';
  let pending = false;

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    pending = true;
    error = '';
    try {
      const me = await auth.login(email, password);
      session.set({ user: me });
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof AuthError && err.code === 'email_unverified') {
        navigate(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      error =
        err instanceof AuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Login failed.';
    } finally {
      pending = false;
    }
  }
</script>

<section class="mx-auto max-w-sm space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">Log in</h1>
  <form class="space-y-4" on:submit={submit}>
    <label class="block">
      <span class="mb-1 block text-sm font-medium text-slate-700">Email</span>
      <input
        type="email"
        bind:value={email}
        required
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
    <label class="block">
      <span class="mb-1 block text-sm font-medium text-slate-700">Password</span>
      <input
        type="password"
        bind:value={password}
        required
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
    {#if error}
      <p class="text-sm text-red-600" role="alert">{error}</p>
    {/if}
    <button
      type="submit"
      disabled={pending}
      class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
  <div class="flex justify-between text-sm text-slate-600">
    <Link to="/signup" getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}>
      Create account
    </Link>
    <Link
      to="/forgot-password"
      getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}
    >
      Forgot password?
    </Link>
  </div>
</section>
