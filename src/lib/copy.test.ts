import { describe, it, expect } from 'vitest';
import { brandCopy, DEFAULT_COPY } from './copy';
import type { Brand } from './brand';

const baseBrand: Brand = {
  code: 'test',
  name: 'Test',
  logoPath: '/x.svg',
  colors: { primary: '#000', accent: '#111', background: '#222', foreground: '#fff' },
  primaryProductCode: 'p',
  copyOverrides: { appName: 'Overridden' },
};

describe('brandCopy', () => {
  it('returns the brand override when present', () => {
    expect(brandCopy(baseBrand, 'appName')).toBe('Overridden');
  });

  it('falls back to DEFAULT_COPY when override missing', () => {
    expect(brandCopy(baseBrand, 'navDashboard')).toBe(DEFAULT_COPY.navDashboard);
  });

  it('uses caller-supplied fallback if neither override nor default exists', () => {
    expect(brandCopy(baseBrand, 'unknownKey', 'fallback!')).toBe('fallback!');
  });

  it('returns the key itself when no override, no default, no fallback', () => {
    expect(brandCopy(baseBrand, 'totallyMissing')).toBe('totallyMissing');
  });
});
