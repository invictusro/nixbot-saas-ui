<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth, AuthError } from '../lib/auth';
  import { session } from '../stores/session';
  import { getQueryParam } from '../lib/query';
  import CodeInput from '../components/CodeInput.svelte';

  let email = getQueryParam('email');
  let code = '';
  let error = '';
  let pending = false;

  $: ready = email.length > 0 && code.length === 6;

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!ready || pending) return;
    pending = true;
    error = '';
    try {
      const user = await auth.verifyEmail(email, code);
      session.set({ user });
      navigate('/dashboard');
    } catch (err) {
      error =
        err instanceof AuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Verification failed.';
      code = '';
    } finally {
      pending = false;
    }
  }
</script>

<section class="mx-auto max-w-sm space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">Verify your email</h1>
  <p class="text-sm text-slate-600">
    Enter the 6-digit code we sent to <span class="font-mono">{email || 'your email'}</span>. Codes
    expire in 10 minutes.
  </p>
  <form class="space-y-4" on:submit={submit}>
    {#if !email}
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
    {/if}
    <div>
      <span class="mb-2 block text-sm font-medium text-slate-700">Verification code</span>
      <CodeInput bind:value={code} disabled={pending} />
    </div>
    {#if error}
      <p class="text-sm text-red-600" role="alert">{error}</p>
    {/if}
    <button
      type="submit"
      disabled={!ready || pending}
      class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Verifying…' : 'Verify'}
    </button>
  </form>
  <p class="text-sm text-slate-600">
    Wrong email?
    <Link to="/signup" getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}>
      Start over
    </Link>
  </p>
</section>
