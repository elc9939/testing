import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultServiceRequestTimeoutMs,
  looksLikeHostedStaticEndpoint,
  requestServiceJson,
  requestServiceResponse,
  serviceEndpointResolution,
  serviceFallbackUrl,
  serviceNetworkContextHint
} from './service-config';

describe('service endpoint resolution', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it('explains hosted HTTPS failures against local desktop services', () => {
    expect(serviceNetworkContextHint('http://127.0.0.1:8791', 'https:')).toContain('hosted HTTPS page');
    expect(serviceNetworkContextHint('http://localhost:8791', 'https:')).toContain('local HTTP desktop service');
    expect(serviceNetworkContextHint('http://192.168.1.50:8791', 'https:')).toContain('insecure LAN HTTP endpoint');
    expect(serviceNetworkContextHint('http://127.0.0.1:8791', 'http:')).toContain('CORS');
  });

  it('aborts hung service JSON requests with an actionable timeout message', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }) as typeof fetch);

    const result = requestServiceJson('aiOs', serviceFallbackUrl('aiOs'), '/api/ai/research/runs', {}, { timeoutMs: 25 });
    const assertion = expect(result).rejects.toThrow('request timed out after 25 ms');

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('keeps a positive default timeout for all service JSON requests', () => {
    expect(defaultServiceRequestTimeoutMs).toBeGreaterThan(0);
  });

  it('turns streamed HTML responses into actionable service setup errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><title>Mini Hub</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );

    await expect(
      requestServiceResponse('aiOs', serviceFallbackUrl('aiOs'), '/api/ai/infer/stream', {
        headers: { accept: 'text/event-stream, application/json' }
      })
    ).rejects.toThrow('returned the web app HTML instead of events');
  });

  it('turns missing streamed routes into endpoint diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain' }
      })
    );

    await expect(
      requestServiceResponse('aiOs', serviceFallbackUrl('aiOs'), '/api/ai/infer/stream', {
        headers: { accept: 'text/event-stream, application/json' }
      })
    ).rejects.toThrow('AI OS API route /api/ai/infer/stream was not found');
  });
});
