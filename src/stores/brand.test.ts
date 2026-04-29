import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

function makeFakeDocument() {
  const props = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const style = {
    setProperty: (name: string, value: string) => {
      props.set(name, value);
    },
    removeProperty: (name: string) => {
      props.delete(name);
    },
    getPropertyValue: (name: string) => props.get(name) ?? '',
  };
  return {
    props,
    dataset,
    document: { documentElement: { style, dataset } },
  };
}

describe('brand store', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalDocument = (globalThis as { document?: unknown }).document;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = originalDocument;
  });

  it('initializes the store from window.location.host and applies CSS vars', async () => {
    (globalThis as { window?: unknown }).window = {
      location: { host: 'app.phonepilot.com' },
    };
    const fake = makeFakeDocument();
    (globalThis as { document?: unknown }).document = fake.document;

    const mod = await import('./brand');
    const value = get(mod.brand);
    expect(value.code).toBe('phonepilot');
    expect(fake.props.get('--brand-primary')).toBe('#7c3aed');
    expect(fake.props.get('--brand-accent')).toBe('#22d3ee');
    expect(fake.props.get('--brand-background')).toBe('#0f0a1a');
    expect(fake.props.get('--brand-foreground')).toBe('#f5f3ff');
    expect(fake.dataset.brand).toBe('phonepilot');
  });

  it('applyBrandTheme is a no-op (no throw) when document is undefined (SSR safety)', async () => {
    (globalThis as { window?: unknown }).window = {
      location: { host: 'app.nixbot.com' },
    };
    delete (globalThis as { document?: unknown }).document;

    const mod = await import('./brand');
    expect(() => mod.applyBrandTheme(get(mod.brand))).not.toThrow();
  });

  it('falls back to the default brand when host is unknown', async () => {
    (globalThis as { window?: unknown }).window = {
      location: { host: 'unknown.example.com' },
    };
    const fake = makeFakeDocument();
    (globalThis as { document?: unknown }).document = fake.document;

    const mod = await import('./brand');
    expect(get(mod.brand).code).toBe('nixbot');
    expect(fake.dataset.brand).toBe('nixbot');
  });
});
