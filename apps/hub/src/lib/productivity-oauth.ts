export type GoogleOAuthCallbackMode = 'api' | 'hub';

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
