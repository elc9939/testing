import { describe, expect, it } from 'vitest';
import {
  googleOAuthCallbackModeForUrls,
  googleOAuthRedirectForCurrentHub,
  googleOAuthStateReturnTo
} from './productivity-oauth';

function fakeOAuthState(payload: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;
}

describe('Google OAuth callback mode', () => {
  it('uses the API callback when the hub and API share an origin', () => {
    expect(
      googleOAuthCallbackModeForUrls(
        'http://127.0.0.1:8787/productivity',
        'http://127.0.0.1:8787'
      )
    ).toBe('api');
  });

  it('uses the hub callback when the hub and API are on different origins', () => {
    expect(
      googleOAuthCallbackModeForUrls(
        'https://elc9939.github.io/testing/productivity',
        'http://127.0.0.1:8787'
      )
    ).toBe('hub');

    expect(
      googleOAuthCallbackModeForUrls(
        'http://127.0.0.1:5173/productivity',
        'http://127.0.0.1:8787'
      )
    ).toBe('hub');
  });

  it('keeps GitHub Pages on the hub callback even if the API URL was stored incorrectly', () => {
    expect(
      googleOAuthCallbackModeForUrls(
        'https://elc9939.github.io/testing/productivity',
        'https://elc9939.github.io'
      )
    ).toBe('hub');
  });

  it('decodes the return URL from OAuth state for hosted callbacks', () => {
    const returnTo = 'https://elc9939.github.io/testing/productivity?panel=mail';

    expect(googleOAuthStateReturnTo(fakeOAuthState({ returnTo }))).toBe(returnTo);
    expect(googleOAuthStateReturnTo('not-valid')).toBe('');
  });

  it('keeps hosted callback completion on the original hub when API hints point at localhost', () => {
    const redirectUrl = googleOAuthRedirectForCurrentHub({
      redirectUrl: 'http://127.0.0.1:5173/productivity?google=connected',
      stateReturnTo: 'https://elc9939.github.io/testing/productivity?panel=mail',
      storedReturnTo: '',
      currentOrigin: 'https://elc9939.github.io',
      fallbackUrl: 'https://elc9939.github.io/testing/productivity',
      status: 'connected'
    });

    expect(redirectUrl).toBe('https://elc9939.github.io/testing/productivity?panel=mail&google=connected');
  });

  it('uses the API redirect when it already targets the current hub origin', () => {
    const redirectUrl = googleOAuthRedirectForCurrentHub({
      redirectUrl: 'https://elc9939.github.io/testing/productivity?panel=calendar&google=connected',
      stateReturnTo: 'https://elc9939.github.io/testing/productivity?panel=mail',
      storedReturnTo: '',
      currentOrigin: 'https://elc9939.github.io',
      fallbackUrl: 'https://elc9939.github.io/testing/productivity',
      status: 'connected'
    });

    expect(redirectUrl).toBe('https://elc9939.github.io/testing/productivity?panel=calendar&google=connected');
  });
});
