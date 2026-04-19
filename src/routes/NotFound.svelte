<script lang="ts">
  import { Link } from 'svelte-routing';
</script>

<section class="rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
  <h1 class="text-3xl font-semibold text-slate-900">404</h1>
  <p class="mt-2 text-sm text-slate-500">This page doesn't exist.</p>
  <div class="mt-6">
    <Link to="/" getProps={() => ({ class: 'text-sm text-slate-900 underline hover:text-slate-700' })}>
      Go home
    </Link>
  </div>
</section>
