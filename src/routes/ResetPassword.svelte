<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth, AuthError } from '../lib/auth';
  import { getQueryParam } from '../lib/query';
  import CodeInput from '../components/CodeInput.svelte';

  let email = getQueryParam('email');
  let code = '';
  let newPassword = '';
  let error = '';
  let pending = false;
  let done = false;

  $: ready = email.length > 0 && code.length === 6 && newPassword.length >= 8;

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!ready || pending) return;
    pending = true;
    error = '';
    try {
      await auth.confirmPasswordReset(email, code, newPassword);
      done = true;
    } catch (err) {
      error =
        err instanceof AuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Reset failed.';
    } finally {
      pending = false;
    }
  }
</script>

<section class="mx-auto max-w-sm space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">Set a new password</h1>
  {#if !done}
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
      <div>
        <span class="mb-2 block text-sm font-medium text-slate-700">Reset code</span>
        <CodeInput bind:value={code} disabled={pending} autofocus={email.length > 0} />
      </div>
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-slate-700">New password</span>
        <input
          type="password"
          bind:value={newPassword}
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
        disabled={!ready || pending}
        class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  {:else}
    <p class="text-sm text-slate-600">Password updated. You can sign in with your new password.</p>
    <button
      type="button"
      on:click={() => navigate('/login')}
      class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      Continue to login
    </button>
  {/if}
  <p class="text-sm text-slate-600">
    Need a new code?
    <Link to="/forgot-password" getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}>
      Request another
    </Link>
  </p>
</section>
