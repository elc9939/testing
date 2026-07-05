import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildServiceUrlFromHubOrigin,
  buildPrivateRemoteBridgeLink,
  buildPrivateRemoteGatewayLink,
  connectionModeForOrigin,
  defaultServiceRequestTimeoutMs,
  looksLikeHostedStaticEndpoint,
  privateRemoteLinks,
  requestServiceJson,
  requestServiceResponse,
  remoteEndpointSuggestions,
  serviceEndpointResolution,
  serviceFallbackUrl,
  serviceNetworkContextHint
} from './service-config';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error('Browser storage blocked');
  }

  clear(): void {
    throw new Error('Browser storage blocked');
  }

  getItem(): string | null {
    throw new Error('Browser storage blocked');
  }

  key(): string | null {
    throw new Error('Browser storage blocked');
  }

  removeItem(): void {
    throw new Error('Browser storage blocked');
  }

  setItem(): void {
    throw new Error('Browser storage blocked');
  }
}

async function sourceFiles(dir = sourceRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = resolve(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(child);
      return entry.isFile() && /\.(?:ts|svelte)$/u.test(entry.name) && !entry.name.endsWith('.test.ts') ? [child] : [];
    })
  );
  return files.flat();
}

describe('service endpoint resolution', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('$app/environment');
  });

  it('keeps browser network calls centralized through service-config', async () => {
    const offenders: string[] = [];

    for (const file of await sourceFiles()) {
      const source = await readFile(file, 'utf8');
      const relativeFile = relative(sourceRoot, file).replace(/\\/gu, '/');
      if (relativeFile === 'lib/service-config.ts') continue;
      if (/\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/u.test(source) || /\bsendBeacon\s*\(/u.test(source)) {
        offenders.push(relativeFile);
      }
    }

    expect(offenders).toEqual([]);
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

  it('keeps endpoint resolution usable when browser storage is blocked', async () => {
    vi.resetModules();
    vi.doMock('$app/environment', () => ({ browser: true }));
    vi.stubGlobal('localStorage', new ThrowingStorage());

    const { getStoredServiceEndpoints, setServiceEndpoint } = await import('./service-config');

    expect(() => setServiceEndpoint('aiOs', 'http://127.0.0.1:8791')).not.toThrow();
    expect(getStoredServiceEndpoints()).toEqual([]);
  });

  it('defaults empty endpoints to the desktop service fallback', () => {
    const resolved = serviceEndpointResolution('hubApi', '', serviceFallbackUrl('hubApi'));

    expect(resolved.state).toBe('defaulted');
    expect(resolved.resolvedUrl).toBe('http://127.0.0.1:8787');
  });

  it('detects same-origin static endpoints before they make /api calls', () => {
    expect(looksLikeHostedStaticEndpoint('https://elc9939.github.io/testing', 'https://elc9939.github.io')).toBe(true);
    expect(looksLikeHostedStaticEndpoint('http://127.0.0.1:5173', 'http://127.0.0.1:5173')).toBe(false);
    expect(looksLikeHostedStaticEndpoint('http://127.0.0.1:8791', 'http://127.0.0.1:5173')).toBe(false);
  });

  it('labels local, private remote, and hosted origins distinctly', () => {
    expect(connectionModeForOrigin('http://127.0.0.1:5173').id).toBe('local-full-power');
    expect(connectionModeForOrigin('http://mini-hub-pc.tailnet.ts.net:5173').id).toBe('private-remote');
    expect(connectionModeForOrigin('http://192.168.1.25:5173').id).toBe('private-remote');
    expect(connectionModeForOrigin('https://elc9939.github.io/testing/').id).toBe('hosted-light');
  });

  it('builds current-host service URL suggestions for private remote mode', () => {
    expect(buildServiceUrlFromHubOrigin('aiOs', 'http://mini-hub-pc.tailnet.ts.net:5173/testing')).toBe(
      'http://mini-hub-pc.tailnet.ts.net:5173'
    );
    expect(remoteEndpointSuggestions('http://192.168.1.25:5173').map((endpoint) => endpoint.url)).toEqual([
      'http://192.168.1.25:5173',
      'http://192.168.1.25:5173',
      'http://192.168.1.25:5173',
      'http://192.168.1.25:5173'
    ]);
    expect(remoteEndpointSuggestions('https://elc9939.github.io/testing')).toEqual([]);
  });

  it('builds a direct phone bridge URL that carries every desktop service endpoint', () => {
    const link = buildPrivateRemoteBridgeLink('http://192.168.1.25:5173/settings');
    const parsed = new URL(link);

    expect(parsed.origin).toBe('http://192.168.1.25:5173');
    expect(parsed.searchParams.get('apiUrl')).toBe('http://192.168.1.25:8787');
    expect(parsed.searchParams.get('aiOsUrl')).toBe('http://192.168.1.25:8791');
    expect(parsed.searchParams.get('macroLabUrl')).toBe('http://192.168.1.25:8792');
    expect(parsed.searchParams.get('ollamaUrl')).toBe('http://192.168.1.25:11434');
  });

  it('builds a single-port gateway phone link for private remote mode', () => {
    const link = buildPrivateRemoteGatewayLink('http://192.168.1.25:5173/settings', 'secret-bridge-token');
    const parsed = new URL(link);

    expect(parsed.origin).toBe('http://192.168.1.25:5173');
    expect(parsed.searchParams.get('gateway')).toBe('single-port');
    expect(parsed.searchParams.get('bridgeToken')).toBe('secret-bridge-token');
    expect(parsed.searchParams.get('apiUrl')).toBe('http://192.168.1.25:5173');
    expect(parsed.searchParams.get('aiOsUrl')).toBe('http://192.168.1.25:5173');
    expect(parsed.searchParams.get('macroLabUrl')).toBe('http://192.168.1.25:5173');
    expect(parsed.searchParams.get('ollamaUrl')).toBe('http://192.168.1.25:5173');
  });

  it('offers private remote links from the current host and detected LAN addresses only', () => {
    expect(privateRemoteLinks('http://127.0.0.1:5173', ['192.168.1.25']).map((link) => link.host)).toEqual(['192.168.1.25']);
    expect(privateRemoteLinks('http://mini-hub-pc.tailnet.ts.net:5173', ['192.168.1.25']).map((link) => link.host)).toEqual([
      'mini-hub-pc.tailnet.ts.net',
      '192.168.1.25'
    ]);
    expect(privateRemoteLinks('https://elc9939.github.io/testing', [])).toEqual([]);
  });

  it('persists bridge-link query endpoints before Settings diagnostics read storage', async () => {
    vi.resetModules();
    vi.doMock('$app/environment', () => ({ browser: true }));
    const storage = new Map<string, string>([
      [
        'miniHub.serviceEndpoints.v1',
        JSON.stringify({
          hubApi: 'http://127.0.0.1:8787',
          aiOs: 'http://127.0.0.1:8791',
          macroLab: 'http://127.0.0.1:8792',
          ollama: 'http://127.0.0.1:11434'
        })
      ]
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: storage.size
    });
    vi.stubGlobal('window', {
      location: {
        origin: 'http://192.168.86.29:5173',
        search:
          '?apiUrl=http%3A%2F%2F192.168.86.29%3A5173&aiOsUrl=http%3A%2F%2F192.168.86.29%3A5173&macroLabUrl=http%3A%2F%2F192.168.86.29%3A5173&ollamaUrl=http%3A%2F%2F192.168.86.29%3A5173&gateway=single-port'
      }
    });

    const { getStoredServiceEndpoints, serviceEndpointResolutions } = await import('./service-config');

    expect(getStoredServiceEndpoints().map((endpoint) => endpoint.url)).toEqual([
      'http://192.168.86.29:5173',
      'http://192.168.86.29:5173',
      'http://192.168.86.29:5173',
      'http://192.168.86.29:5173'
    ]);
    expect(serviceEndpointResolutions().map((endpoint) => endpoint.resolvedUrl)).toEqual([
      'http://192.168.86.29:5173',
      'http://192.168.86.29:5173',
      'http://192.168.86.29:5173',
      'http://192.168.86.29:5173'
    ]);
  });

  it('persists bridge tokens from private gateway links before service requests', async () => {
    vi.resetModules();
    vi.doMock('$app/environment', () => ({ browser: true }));
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: 0
    });
    vi.stubGlobal('window', {
      location: {
        origin: 'https://example.trycloudflare.com',
        search: '?apiUrl=https%3A%2F%2Fexample.trycloudflare.com&bridgeToken=secret-bridge-token'
      }
    });

    const { applyQueryServiceEndpoints, bridgeAuthHeaders } = await import('./service-config');

    applyQueryServiceEndpoints();
    expect(bridgeAuthHeaders('hubApi')).toEqual({ 'X-Mini-Hub-Bridge-Token': 'secret-bridge-token' });
    expect(bridgeAuthHeaders('aiOs')).toEqual({ 'X-Mini-Hub-Bridge-Token': 'secret-bridge-token' });
  });

  it('stores an optional bridge token and sends it only to Mini Hub-controlled services', async () => {
    vi.resetModules();
    vi.doMock('$app/environment', () => ({ browser: true }));
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: 0
    });

    const { bridgeAuthHeaders, setBridgeToken } = await import('./service-config');

    setBridgeToken('secret-bridge-token');

    expect(bridgeAuthHeaders('hubApi')).toEqual({ 'X-Mini-Hub-Bridge-Token': 'secret-bridge-token' });
    expect(bridgeAuthHeaders('aiOs')).toEqual({ 'X-Mini-Hub-Bridge-Token': 'secret-bridge-token' });
    expect(bridgeAuthHeaders('macroLab')).toEqual({ 'X-Mini-Hub-Bridge-Token': 'secret-bridge-token' });
    expect(bridgeAuthHeaders('ollama')).toEqual({});
  });

  it('sends the bridge token to Ollama when Ollama is behind the same-origin gateway', async () => {
    vi.resetModules();
    vi.doMock('$app/environment', () => ({ browser: true }));
    const storage = new Map<string, string>([
      ['miniHub.serviceEndpoints.v1', JSON.stringify({ ollama: 'https://example.trycloudflare.com' })]
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: storage.size
    });
    vi.stubGlobal('window', {
      location: {
        origin: 'https://example.trycloudflare.com',
        search: ''
      }
    });

    const { bridgeAuthHeaders, setBridgeToken } = await import('./service-config');

    setBridgeToken('secret-bridge-token');

    expect(bridgeAuthHeaders('ollama')).toEqual({ 'X-Mini-Hub-Bridge-Token': 'secret-bridge-token' });
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

  it('turns HTML JSON responses into actionable service setup errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><title>Mini Hub</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );

    await expect(requestServiceJson('hubApi', serviceFallbackUrl('hubApi'), '/api/health')).rejects.toThrow(
      'returned the web app HTML instead of JSON'
    );
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
