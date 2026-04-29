import type { Brand } from './brand';

export const DEFAULT_COPY: Record<string, string> = {
  appName: 'Nixbot',
  tagline: 'Run your Instagram automation on real phones.',
  navDashboard: 'Dashboard',
  navBilling: 'Billing',
  navCustomers: 'Customers',
  navLogin: 'Login',
  navSignup: 'Sign up',
};

export function brandCopy(brand: Brand, key: string, fallback?: string): string {
  const override = brand.copyOverrides[key];
  if (override !== undefined) return override;
  if (DEFAULT_COPY[key] !== undefined) return DEFAULT_COPY[key];
  return fallback ?? key;
}
