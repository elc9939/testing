import { describe, expect, it } from 'vitest';
import {
  looksLikeHostedStaticEndpoint,
  serviceEndpointResolution,
  serviceFallbackUrl
} from './service-config';

describe('service endpoint resolution', () => {
  it('does not treat the hosted GitHub Pages app as an API service', () => {
    const resolved = serviceEndpointResolution(
      'aiOs',
      'https://elc9939.github.io/testing',
      serviceFallbackUrl('aiOs'),
      'https://elc9939.github.io'
    );

    expect(resolved.state).toBe('misconfigured');
    expect(resolved.resolvedUrl).toBe('http://127.0.0.1:8791');
    expect(resolved.detail).toContain('Mini Hub website');
  });

  it('keeps explicit localhost endpoints ready', () => {
    const resolved = serviceEndpointResolution('macroLab', 'http://127.0.0.1:8792/', serviceFallbackUrl('macroLab'));

    expect(resolved.state).toBe('ready');
    expect(resolved.resolvedUrl).toBe('http://127.0.0.1:8792');
  });

  it('defaults empty endpoints to the desktop service fallback', () => {
    const resolved = serviceEndpointResolution('hubApi', '', serviceFallbackUrl('hubApi'));

    expect(resolved.state).toBe('defaulted');
    expect(resolved.resolvedUrl).toBe('http://127.0.0.1:8787');
  });

  it('detects same-origin static endpoints before they make /api calls', () => {
    expect(looksLikeHostedStaticEndpoint('https://elc9939.github.io/testing', 'https://elc9939.github.io')).toBe(true);
    expect(looksLikeHostedStaticEndpoint('http://127.0.0.1:5173', 'http://127.0.0.1:5173')).toBe(true);
    expect(looksLikeHostedStaticEndpoint('http://127.0.0.1:8791', 'http://127.0.0.1:5173')).toBe(false);
  });
});
