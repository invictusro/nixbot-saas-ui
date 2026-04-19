<script lang="ts">
  import { onMount, tick } from 'svelte';

  export let value = '';
  export let length = 6;
  export let disabled = false;
  export let autofocus = true;

  let inputs: HTMLInputElement[] = [];

  onMount(() => {
    if (autofocus) inputs[0]?.focus();
  });

  $: digits = padDigits(value, length);

  function padDigits(v: string, n: number): string[] {
    const arr = v.replace(/\D/g, '').slice(0, n).split('');
    while (arr.length < n) arr.push('');
    return arr;
  }

  function setValueFrom(arr: string[]): void {
    value = arr.join('').replace(/\s/g, '');
  }

  async function focusIndex(i: number): Promise<void> {
    await tick();
    const el = inputs[i];
    if (el) {
      el.focus();
      el.select();
    }
  }

  async function onInput(i: number, e: Event): Promise<void> {
    const target = e.target as HTMLInputElement;
    const raw = target.value.replace(/\D/g, '');
    if (raw.length === 0) {
      const arr = digits.slice();
      arr[i] = '';
      setValueFrom(arr);
      return;
    }
    const arr = digits.slice();
    let idx = i;
    for (const ch of raw) {
      if (idx >= length) break;
      arr[idx] = ch;
      idx += 1;
    }
    setValueFrom(arr);
    await focusIndex(Math.min(idx, length - 1));
  }

  async function onKeyDown(i: number, e: KeyboardEvent): Promise<void> {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      const arr = digits.slice();
      arr[i - 1] = '';
      setValueFrom(arr);
      await focusIndex(i - 1);
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      await focusIndex(i - 1);
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      e.preventDefault();
      await focusIndex(i + 1);
    }
  }

  async function onPaste(e: ClipboardEvent): Promise<void> {
    const text = e.clipboardData?.getData('text') ?? '';
    const cleaned = text.replace(/\D/g, '').slice(0, length);
    if (!cleaned) return;
    e.preventDefault();
    setValueFrom(padDigits(cleaned, length));
    await focusIndex(Math.min(cleaned.length, length - 1));
  }
</script>

<div class="flex gap-2" on:paste={onPaste} role="group" aria-label="Verification code">
  {#each digits as digit, i}
    <input
      bind:this={inputs[i]}
      type="text"
      inputmode="numeric"
      autocomplete={i === 0 ? 'one-time-code' : 'off'}
      maxlength="1"
      value={digit}
      {disabled}
      aria-label={`Digit ${i + 1}`}
      on:input={(e) => onInput(i, e)}
      on:keydown={(e) => onKeyDown(i, e)}
      class="h-12 w-10 rounded-md border border-slate-300 bg-white text-center font-mono text-lg focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
    />
  {/each}
</div>
