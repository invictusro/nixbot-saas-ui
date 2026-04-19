<script lang="ts">
  import type { AccountStatus } from '../lib/stores';

  export let status: AccountStatus;

  const PALETTE: Record<AccountStatus, { color: 'green' | 'yellow' | 'red'; label: string }> = {
    ready: { color: 'green', label: 'Ready' },
    active: { color: 'green', label: 'Active' },
    warming: { color: 'green', label: 'Warming' },
    paused: { color: 'yellow', label: 'Paused' },
    suspended: { color: 'yellow', label: 'Suspended' },
    banned: { color: 'red', label: 'Banned' },
    error: { color: 'red', label: 'Error' },
    deleted: { color: 'red', label: 'Deleted' },
  };

  const CLASSES: Record<'green' | 'yellow' | 'red', string> = {
    green: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600/20',
    yellow: 'bg-amber-100 text-amber-800 ring-1 ring-amber-600/20',
    red: 'bg-rose-100 text-rose-700 ring-1 ring-rose-600/20',
  };

  $: entry = PALETTE[status] ?? { color: 'red' as const, label: status };
  $: klass = CLASSES[entry.color];
</script>

<span
  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {klass}"
  data-testid="status-badge"
  data-status={status}
  data-color={entry.color}
>
  {entry.label}
</span>
