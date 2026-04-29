import { readable } from 'svelte/store';
import { getCurrentBrand, type Brand } from '../lib/brand';

const initial = getCurrentBrand();

export function applyBrandTheme(brand: Brand): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', brand.colors.primary);
  root.style.setProperty('--brand-accent', brand.colors.accent);
  root.style.setProperty('--brand-background', brand.colors.background);
  root.style.setProperty('--brand-foreground', brand.colors.foreground);
  root.dataset.brand = brand.code;
}

applyBrandTheme(initial);

export const brand = readable<Brand>(initial);
