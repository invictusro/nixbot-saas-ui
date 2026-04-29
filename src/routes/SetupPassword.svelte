<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth, AuthError } from '../lib/auth';
  import { getQueryParam } from '../lib/query';
  import { session } from '../stores/session';

  const token = getQueryParam('token');
  let password = '';
  let confirm = '';
  let error = '';
  let pending = false;

  $: passwordTooShort = password.length > 0 && password.length < 8;
  $: passwordsMismatch = confirm.length > 0 && password !== confirm;
  $: ready = token.length > 0 && password.length >= 8 && password === confirm;

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!ready || pending) return;
    pending = true;
    error = '';
    try {
      const me = await auth.setupPassword(token, password);
      session.set({ user: me });
      navigate('/dashboard');
    } catch (err) {
      error =
        err instanceof AuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Setup failed.';
    } finally {
      pending = false;
    }
  }
</script>

<section class="mx-auto max-w-sm space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">Set your password</h1>
  {#if !token}
    <p class="text-sm text-red-600" role="alert">
      This link is missing its setup token. Request a new one below.
    </p>
    <Link
      to="/forgot-password"
      getProps={() => ({ class: 'inline-block text-sm font-medium text-slate-900 hover:underline' })}
    >
      Request a new link
    </Link>
  {:else}
    <p class="text-sm text-slate-600">
      Choose a password to access your dashboard. Use at least 8 characters.
    </p>
    <form class="space-y-4" on:submit={submit}>
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-slate-700">New password</span>
        <input
          type="password"
          bind:value={password}
          required
          minlength="8"
          autocomplete="new-password"
          data-testid="password"
          class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        {#if passwordTooShort}
          <span class="mt-1 block text-xs text-red-600" role="alert" data-testid="weak-password">
            Password must be at least 8 characters.
          </span>
        {:else}
          <span class="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
        {/if}
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-slate-700">Confirm password</span>
        <input
          type="password"
          bind:value={confirm}
          required
          minlength="8"
          autocomplete="new-password"
          data-testid="confirm"
          class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        {#if passwordsMismatch}
          <span class="mt-1 block text-xs text-red-600" role="alert" data-testid="mismatch">
            Passwords do not match.
          </span>
        {/if}
      </label>
      {#if error}
        <p class="text-sm text-red-600" role="alert" data-testid="setup-error">{error}</p>
        <p class="text-sm text-slate-600">
          Link expired or already used?
          <Link
            to="/forgot-password"
            getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}
          >
            Request a new one
          </Link>
        </p>
      {/if}
      <button
        type="submit"
        disabled={!ready || pending}
        data-testid="submit"
        class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set password and continue'}
      </button>
    </form>
  {/if}
</section>
