<script lang="ts">
  import { onMount } from 'svelte';
  import AdminGuard from '../components/AdminGuard.svelte';
  import {
    adminClient,
    type AdminCatalogSKU,
    type AdminCatalogOffering,
  } from '../lib/api';
  import { getAllBrandCodes } from '../lib/brand';

  const BRAND_CODES = getAllBrandCodes();

  let skus: AdminCatalogSKU[] = [];
  let loading = true;
  let loadError = '';

  // Inline editor state. Keyed by `${skuId}::${brandCode}`.
  let editingKey: string | null = null;
  let editingValue = '';
  let editingExisting: AdminCatalogOffering | null = null;
  let editingSubmitting = false;
  let editingError = '';

  function cellKey(skuId: string, brand: string): string {
    return `${skuId}::${brand}`;
  }

  function offeringFor(sku: AdminCatalogSKU, brand: string): AdminCatalogOffering | null {
    return sku.offerings.find((o) => o.brand_code === brand) ?? null;
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const page = await adminClient.listCatalogSKUs({ limit: 200 });
      skus = page.items;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load catalog';
    } finally {
      loading = false;
    }
  }

  function openEditor(sku: AdminCatalogSKU, brand: string): void {
    const existing = offeringFor(sku, brand);
    editingKey = cellKey(sku.id, brand);
    editingExisting = existing;
    editingValue = existing ? (existing.price_cents / 100).toFixed(2) : '';
    editingError = '';
  }

  function cancelEditor(): void {
    editingKey = null;
    editingExisting = null;
    editingValue = '';
    editingError = '';
    editingSubmitting = false;
  }

  function parseDollars(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    const cents = Math.round(parseFloat(trimmed) * 100);
    return Number.isFinite(cents) && cents >= 0 ? cents : null;
  }

  async function submitEdit(skuId: string, brand: string): Promise<void> {
    const cents = parseDollars(editingValue);
    if (cents === null) {
      editingError = 'Enter a non-negative dollar amount (e.g. 19.00).';
      return;
    }
    if (editingExisting && editingExisting.price_cents !== cents) {
      const ok = window.confirm(
        `Change ${brand} ${skuId} price from $${(editingExisting.price_cents / 100).toFixed(2)} to $${(cents / 100).toFixed(2)}?`,
      );
      if (!ok) return;
    }
    editingSubmitting = true;
    editingError = '';
    try {
      let updated: AdminCatalogOffering;
      if (editingExisting) {
        updated = await adminClient.updateOfferingPrice(editingExisting.id, cents);
      } else {
        updated = await adminClient.createOffering({
          sku_id: skuId,
          brand_code: brand,
          price_cents: cents,
        });
      }
      // Splice into local state without a full reload.
      skus = skus.map((s) => {
        if (s.id !== skuId) return s;
        const idx = s.offerings.findIndex((o) => o.brand_code === brand);
        const next = idx >= 0
          ? s.offerings.map((o, i) => (i === idx ? updated : o))
          : [...s.offerings, updated];
        return { ...s, offerings: next };
      });
      cancelEditor();
    } catch (e) {
      editingError = e instanceof Error ? e.message : 'Failed to save price';
    } finally {
      editingSubmitting = false;
    }
  }

  onMount(() => {
    void load();
  });

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }
</script>

<AdminGuard>
  <section class="space-y-6" data-testid="admin-catalog">
    <header class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h1 class="text-2xl font-semibold text-slate-900">Catalog</h1>
      <p class="text-sm text-slate-500">SKU pricing across all brands. Click a cell to edit or create an offering.</p>
    </header>

    {#if loading}
      <p class="text-sm text-slate-500" data-testid="catalog-loading">Loading…</p>
    {:else if loadError}
      <p role="alert" class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </p>
    {:else if skus.length === 0}
      <p class="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500" data-testid="catalog-empty">
        No SKUs configured.
      </p>
    {:else}
      <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table class="min-w-full text-sm" data-testid="catalog-table">
          <thead>
            <tr class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="px-4 py-2">SKU</th>
              <th class="px-4 py-2">Billing</th>
              {#each BRAND_CODES as brand}
                <th class="px-4 py-2" data-testid="catalog-brand-header" data-brand-code={brand}>
                  {brand}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each skus as sku (sku.id)}
              <tr class="border-b border-slate-100 last:border-0" data-testid="catalog-row" data-sku-id={sku.id}>
                <td class="px-4 py-2 font-medium text-slate-900">
                  {sku.code}
                  {#if !sku.active}
                    <span class="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">inactive</span>
                  {/if}
                </td>
                <td class="px-4 py-2 text-slate-600">{sku.billing_type}</td>
                {#each BRAND_CODES as brand}
                  {@const off = offeringFor(sku, brand)}
                  {@const key = cellKey(sku.id, brand)}
                  <td
                    class="px-4 py-2"
                    data-testid="catalog-cell"
                    data-sku-id={sku.id}
                    data-brand-code={brand}
                    data-state={off ? 'offered' : 'empty'}
                  >
                    {#if editingKey === key}
                      <div class="flex flex-col gap-1" data-testid="catalog-editor">
                        <div class="flex items-center gap-1">
                          <span class="text-slate-500">$</span>
                          <input
                            type="text"
                            inputmode="decimal"
                            bind:value={editingValue}
                            class="w-24 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
                            data-testid="catalog-editor-input"
                            disabled={editingSubmitting}
                          />
                          <button
                            type="button"
                            class="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                            data-testid="catalog-editor-save"
                            disabled={editingSubmitting}
                            on:click={() => submitEdit(sku.id, brand)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            data-testid="catalog-editor-cancel"
                            on:click={cancelEditor}
                          >
                            Cancel
                          </button>
                        </div>
                        {#if editingError}
                          <p class="text-xs text-red-600" data-testid="catalog-editor-error">{editingError}</p>
                        {/if}
                      </div>
                    {:else if off}
                      <button
                        type="button"
                        class="rounded px-2 py-1 text-left font-medium text-slate-900 hover:bg-slate-100"
                        data-testid="catalog-cell-button"
                        data-state="offered"
                        on:click={() => openEditor(sku, brand)}
                      >
                        {dollars(off.price_cents)}
                        {#if !off.active}
                          <span class="ml-1 text-xs text-slate-500">(inactive)</span>
                        {/if}
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="rounded px-2 py-1 text-left text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        data-testid="catalog-cell-button"
                        data-state="empty"
                        on:click={() => openEditor(sku, brand)}
                      >
                        —
                      </button>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</AdminGuard>
