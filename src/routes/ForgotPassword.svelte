<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import { auth, AuthError } from '../lib/auth';

  let email = '';
  let error = '';
  let pending = false;
  let sent = false;

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    pending = true;
    error = '';
    try {
      await auth.requestPasswordReset(email);
      sent = true;
    } catch (err) {
      error =
        err instanceof AuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not send reset code.';
    } finally {
      pending = false;
    }
  }

  function continueToReset(): void {
    navigate(`/reset-password?email=${encodeURIComponent(email)}`);
  }
</script>

<section class="mx-auto max-w-sm space-y-6">
  <h1 class="text-2xl font-semibold text-slate-900">Reset your password</h1>
  {#if !sent}
    <p class="text-sm text-slate-600">
      Enter the email on your account. We will send a 6-digit code to reset your password.
    </p>
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
      {#if error}
        <p class="text-sm text-red-600" role="alert">{error}</p>
      {/if}
      <button
        type="submit"
        disabled={pending}
        class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send reset code'}
      </button>
    </form>
  {:else}
    <p class="text-sm text-slate-600">
      If an account exists for <span class="font-mono">{email}</span>, a 6-digit code is on its way.
      Check your inbox, then enter the code on the next page.
    </p>
    <button
      type="button"
      on:click={continueToReset}
      class="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      Enter reset code
    </button>
  {/if}
  <p class="text-sm text-slate-600">
    Remembered it?
    <Link to="/login" getProps={() => ({ class: 'font-medium text-slate-900 hover:underline' })}>
      Log in
    </Link>
  </p>
</section>
