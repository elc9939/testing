import { describe, expect, it } from 'vitest';
import { googleOAuthCallbackModeForUrls } from './productivity-oauth';

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
});
