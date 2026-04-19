export function getQueryParam(name: string, search?: string): string {
  const s = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const params = new URLSearchParams(s);
  return params.get(name) ?? '';
}
