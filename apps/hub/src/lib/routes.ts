import { base } from '$app/paths';

export function hubHref(route: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(route)) return route;
  const normalized = route.startsWith('/') ? route : `/${route}`;
  if (normalized === '/') return base || '/';
  return `${base}${normalized}`;
}

export function hubRouteFromPath(pathname: string): string {
  if (base && pathname.startsWith(base)) {
    const stripped = pathname.slice(base.length);
    return stripped || '/';
  }
  return pathname || '/';
}
