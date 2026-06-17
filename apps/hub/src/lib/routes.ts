import { base } from '$app/paths';

const fallbackLegacyUrl = 'https://elc9939.github.io/testing/legacy/';

export function hubHref(route: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(route)) return route;
  const normalized = route.startsWith('/') ? route : `/${route}`;
  if (normalized === '/') return base || '/';
  return `${base}${normalized}`;
}

export function legacyHref(): string {
  return base ? `${base}/legacy/` : fallbackLegacyUrl;
}

export function hubRouteFromPath(pathname: string): string {
  if (base && pathname.startsWith(base)) {
    const stripped = pathname.slice(base.length);
    return stripped || '/';
  }
  return pathname || '/';
}
