import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  BRANDS,
  DEFAULT_BRAND_CODE,
  getCurrentBrand,
  resolveBrandFromHost,
} from './brand';

describe('BRANDS map', () => {
  it('includes nixbot, phonepilot, and a localhost dev fallback', () => {
    expect(BRANDS['app.nixbot.com']?.code).toBe('nixbot');
    expect(BRANDS['app.phonepilot.com']?.code).toBe('phonepilot');
    expect(BRANDS['localhost']).toBeDefined();
  });

  it('has well-typed entries with required fields', () => {
    for (const [host, brand] of Object.entries(BRANDS)) {
      expect(typeof brand.code).toBe('string');
      expect(typeof brand.name).toBe('string');
      expect(typeof brand.logoPath).toBe('string');
      expect(typeof brand.primaryProductCode).toBe('string');
      expect(typeof brand.colors.primary).toBe('string');
      expect(typeof brand.colors.accent).toBe('string');
      expect(brand.copyOverrides).toBeDefined();
      expect(host).toEqual(host.toLowerCase());
    }
  });
});

describe('resolveBrandFromHost', () => {
  it('returns the configured brand for each known host', () => {
    expect(resolveBrandFromHost('app.nixbot.com').code).toBe('nixbot');
    expect(resolveBrandFromHost('app.phonepilot.com').code).toBe('phonepilot');
    expect(resolveBrandFromHost('localhost').code).toBe(DEFAULT_BRAND_CODE);
  });

  it('strips port suffixes and is case-insensitive', () => {
    expect(resolveBrandFromHost('localhost:5173').code).toBe(DEFAULT_BRAND_CODE);
    expect(resolveBrandFromHost('App.PhonePilot.com').code).toBe('phonepilot');
  });

  it('falls back to the default brand for an unknown host without throwing', () => {
    expect(() => resolveBrandFromHost('totally-unknown.example')).not.toThrow();
    expect(resolveBrandFromHost('totally-unknown.example').code).toBe(
      DEFAULT_BRAND_CODE,
    );
  });

  it('falls back to the default brand for empty/null/undefined host', () => {
    expect(resolveBrandFromHost('').code).toBe(DEFAULT_BRAND_CODE);
    expect(resolveBrandFromHost(undefined).code).toBe(DEFAULT_BRAND_CODE);
    expect(resolveBrandFromHost(null).code).toBe(DEFAULT_BRAND_CODE);
  });
});

describe('getCurrentBrand', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  it('uses window.location.host when present', () => {
    (globalThis as { window?: unknown }).window = {
      location: { host: 'app.phonepilot.com' },
    };
    expect(getCurrentBrand().code).toBe('phonepilot');
  });

  it('falls back to the default when host is unknown', () => {
    (globalThis as { window?: unknown }).window = {
      location: { host: 'random.example.com' },
    };
    expect(() => getCurrentBrand()).not.toThrow();
    expect(getCurrentBrand().code).toBe(DEFAULT_BRAND_CODE);
  });

  it('is SSR-safe when window is undefined', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => getCurrentBrand()).not.toThrow();
    expect(getCurrentBrand().code).toBe(DEFAULT_BRAND_CODE);
  });
});
