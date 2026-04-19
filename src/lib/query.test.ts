import { describe, it, expect } from 'vitest';
import { getQueryParam } from './query';

describe('getQueryParam', () => {
  it('returns empty string when missing', () => {
    expect(getQueryParam('email', '')).toBe('');
    expect(getQueryParam('email', '?other=1')).toBe('');
  });

  it('decodes a present param', () => {
    expect(getQueryParam('email', '?email=a%40b.com')).toBe('a@b.com');
  });
});
