export type GoogleOAuthCallbackMode = 'api' | 'hub';

export const googleOAuthReturnToStorageKey = 'miniHub.googleOAuth.returnTo.v1';

export function googleOAuthCallbackModeForUrls(hubUrl: string, apiUrl: string): GoogleOAuthCallbackMode {
  try {
    const hub = new URL(hubUrl);
    const api = new URL(apiUrl);
    if (hub.hostname.endsWith('github.io') || api.hostname.endsWith('github.io')) return 'hub';
    return hub.origin === api.origin ? 'api' : 'hub';
  } catch {
    return 'api';
  }
}

function sameOriginUrl(value: string | undefined, currentOrigin: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, currentOrigin);
    return url.origin === currentOrigin ? url.toString() : '';
  } catch {
    return '';
  }
}

function withGoogleStatus(value: string, status: string, message?: string): string {
  const url = new URL(value);
  url.searchParams.set('google', status);
  if (message) url.searchParams.set('message', message);
  else url.searchParams.delete('message');
  return url.toString();
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = globalThis.atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function googleOAuthStateReturnTo(state: string | undefined): string {
  if (!state) return '';
  const [payload] = state.split('.');
  if (!payload) return '';
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as { returnTo?: unknown };
    return typeof parsed.returnTo === 'string' ? parsed.returnTo : '';
  } catch {
    return '';
  }
}

export function googleOAuthRedirectForCurrentHub(input: {
  redirectUrl?: string | undefined;
  stateReturnTo?: string | undefined;
  storedReturnTo?: string | undefined;
  currentOrigin: string;
  fallbackUrl: string;
  status: string;
  message?: string | undefined;
}): string {
  const sameOriginRedirect =
    sameOriginUrl(input.redirectUrl, input.currentOrigin) ||
    sameOriginUrl(input.stateReturnTo, input.currentOrigin) ||
    sameOriginUrl(input.storedReturnTo, input.currentOrigin) ||
    sameOriginUrl(input.fallbackUrl, input.currentOrigin);

  return withGoogleStatus(sameOriginRedirect || input.fallbackUrl, input.status, input.message);
}
