<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth } from '../lib/auth';
  import { AuthError } from '../lib/auth';

  let email = '';
  let password = '';
  let error = '';
  let pending = false;

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    pending = true;
    error = '';
    try {
      await auth.register(email, password);
      navigate(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      error =
        err instanceof AuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Sign-up failed.';
    } finally {
      pending = false;
    }
  }
</script>

<section class="mx-auto max-w-sm space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">Create your account</h1>
  <form class="space-y-4" on:submit={submit}>
    <label class="block">
      <span class="mb-1 block text-sm font-medium text-slate-700">Email</span>
      <input
        type="email"
        bind:value={email}
        required
        autocomplete="email"
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
    <label class="block">
      <span class="mb-1 block text-sm font-medium text-slate-700">Password</span>
      <input
        type="password"
        bind:value={password}
        required
        minlength="8"
        autocomplete="new-password"
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
      <span class="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
    </label>
    {#if error}
      <p class="text-sm text-red-600" role="alert">{error}</p>
    {/if}
    <button
      type="submit"
      disabled={pending}
      class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Creating account…' : 'Create account'}
    </button>
  </form>
  <p class="text-sm text-slate-600">
    Already have an account?
    <Link to="/login" getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}>
      Log in
    </Link>
  </p>
</section>
