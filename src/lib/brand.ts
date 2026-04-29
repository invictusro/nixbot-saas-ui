export interface BrandColors {
  primary: string;
  accent: string;
  background: string;
  foreground: string;
}

export type CopyOverrides = Record<string, string>;

export interface Brand {
  code: string;
  name: string;
  logoPath: string;
  colors: BrandColors;
  primaryProductCode: string;
  copyOverrides: CopyOverrides;
}

export const DEFAULT_BRAND_CODE = 'nixbot';

export const BRANDS: Readonly<Record<string, Brand>> = Object.freeze({
  'app.nixbot.com': {
    code: 'nixbot',
    name: 'Nixbot',
    logoPath: '/brands/nixbot/logo.svg',
    colors: {
      primary: '#2563eb',
      accent: '#0ea5e9',
      background: '#0b1220',
      foreground: '#f8fafc',
    },
    primaryProductCode: 'byo_panel',
    copyOverrides: {
      appName: 'Nixbot',
      tagline: 'Run your Instagram automation on real phones.',
    },
  },
  'app.phonepilot.com': {
    code: 'phonepilot',
    name: 'PhonePilot',
    logoPath: '/brands/phonepilot/logo.svg',
    colors: {
      primary: '#7c3aed',
      accent: '#22d3ee',
      background: '#0f0a1a',
      foreground: '#f5f3ff',
    },
    primaryProductCode: 'managed_posting',
    copyOverrides: {
      appName: 'PhonePilot',
      tagline: 'Hands-off Instagram growth, piloted by us.',
    },
  },
  localhost: {
    code: 'nixbot',
    name: 'Nixbot (dev)',
    logoPath: '/brands/nixbot/logo.svg',
    colors: {
      primary: '#2563eb',
      accent: '#0ea5e9',
      background: '#0b1220',
      foreground: '#f8fafc',
    },
    primaryProductCode: 'byo_panel',
    copyOverrides: {
      appName: 'Nixbot (dev)',
      tagline: 'Run your Instagram automation on real phones.',
    },
  },
});

export function resolveBrandFromHost(host: string | undefined | null): Brand {
  if (host) {
    const bare = host.split(':')[0].toLowerCase();
    const direct = BRANDS[bare];
    if (direct) return direct;
  }
  return BRANDS[`app.${DEFAULT_BRAND_CODE}.com`];
}

export function getCurrentBrand(): Brand {
  const host = typeof window !== 'undefined' && window.location ? window.location.host : undefined;
  return resolveBrandFromHost(host);
}

export function getAllBrandCodes(): string[] {
  const seen = new Set<string>();
  for (const brand of Object.values(BRANDS)) seen.add(brand.code);
  return Array.from(seen).sort();
}
