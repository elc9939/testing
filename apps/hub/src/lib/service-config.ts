import { browser } from '$app/environment';

export type ServiceId = 'hubApi' | 'aiOs' | 'macroLab';

export interface ServiceEndpoint {
  id: ServiceId;
  label: string;
  url: string;
}

export type ServiceEndpointState = 'ready' | 'defaulted' | 'misconfigured' | 'empty';

export interface ServiceEndpointResolution {
  id: ServiceId;
  label: string;
  requestedUrl: string;
  resolvedUrl: string;
  state: ServiceEndpointState;
  detail: string;
  fixAction: string;
}

const storageKey = 'miniHub.serviceEndpoints.v1';

const queryNames: Record<ServiceId, string[]> = {
  hubApi: ['apiUrl', 'hubApiUrl'],
  aiOs: ['aiOsUrl', 'aiOsApiUrl'],
  macroLab: ['macroLabUrl', 'macroLabApiUrl']
};

const serviceLabels: Record<ServiceId, string> = {
  hubApi: 'Mini Hub API',
  aiOs: 'AI OS API',
  macroLab: 'Macro Lab API'
};

const desktopFallbacks: Record<ServiceId, string> = {
  hubApi: 'http://127.0.0.1:8787',
  aiOs: 'http://127.0.0.1:8791',
  macroLab: 'http://127.0.0.1:8792'
};

const serviceHealthPaths: Record<ServiceId, string> = {
  hubApi: '/api/health',
  aiOs: '/api/ai/health',
  macroLab: '/api/macro-lab/health'
};

export const defaultServiceRequestTimeoutMs = 15_000;

function readStoredEndpoints(): Partial<Record<ServiceId, string>> {
  if (!browser) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<Record<ServiceId, string>>) : {};
  } catch {
    return {};
  }
}

function writeStoredEndpoints(endpoints: Partial<Record<ServiceId, string>>): void {
  if (!browser) return;
  localStorage.setItem(storageKey, JSON.stringify(endpoints));
}

function queryEndpoint(id: ServiceId): string {
  if (!browser) return '';
  const params = new URLSearchParams(window.location.search);
  for (const name of queryNames[id]) {
    const value = normalizeServiceUrl(params.get(name) ?? '');
    if (value) return value;
  }
  return '';
}

export function normalizeServiceUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed;
  }
}

export function serviceLabel(id: ServiceId): string {
  return serviceLabels[id];
}

export function serviceFallbackUrl(id: ServiceId): string {
  return desktopFallbacks[id];
}

export function serviceHealthPath(id: ServiceId): string {
  return serviceHealthPaths[id];
}

export function looksLikeHostedStaticEndpoint(value: string, currentOrigin = ''): boolean {
  const normalized = normalizeServiceUrl(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    if (/github\.io$/iu.test(url.hostname)) return true;
    return Boolean(currentOrigin && normalized === normalizeServiceUrl(currentOrigin));
  } catch {
    return false;
  }
}

export function serviceEndpointResolution(
  id: ServiceId,
  requestedValue: string | undefined,
  fallback = desktopFallbacks[id],
  currentOrigin = ''
): ServiceEndpointResolution {
  const requestedUrl = normalizeServiceUrl(requestedValue ?? '');
  const fallbackUrl = normalizeServiceUrl(fallback);
  if (requestedUrl && looksLikeHostedStaticEndpoint(requestedUrl, currentOrigin)) {
    return {
      id,
      label: serviceLabels[id],
      requestedUrl,
      resolvedUrl: fallbackUrl,
      state: 'misconfigured',
      detail: `${requestedUrl} is the Mini Hub website, not the ${serviceLabels[id]}.`,
      fixAction: `Start the desktop service and use ${fallbackUrl}, or save the LAN URL printed by the launcher.`
    };
  }
  if (requestedUrl) {
    return {
      id,
      label: serviceLabels[id],
      requestedUrl,
      resolvedUrl: requestedUrl,
      state: 'ready',
      detail: `Requests will use ${requestedUrl}.`,
      fixAction: 'No endpoint fix needed.'
    };
  }
  return {
    id,
    label: serviceLabels[id],
    requestedUrl: '',
    resolvedUrl: fallbackUrl,
    state: fallbackUrl ? 'defaulted' : 'empty',
    detail: fallbackUrl ? `No saved endpoint; using ${fallbackUrl}.` : 'No endpoint is configured.',
    fixAction: fallbackUrl ? 'Start the matching desktop service.' : 'Save an endpoint in Settings.'
  };
}

export function clearServiceEndpoint(id: ServiceId): void {
  const stored = readStoredEndpoints();
  delete stored[id];
  writeStoredEndpoints(stored);
}

export function resolveServiceUrl(id: ServiceId, envValue: string | undefined, fallback: string): string {
  const currentOrigin = browser && typeof window !== 'undefined' ? window.location.origin : '';
  const fromQuery = queryEndpoint(id);
  if (fromQuery) {
    const stored = readStoredEndpoints();
    const resolved = serviceEndpointResolution(id, fromQuery, fallback, currentOrigin);
    if (resolved.state === 'misconfigured') {
      delete stored[id];
      writeStoredEndpoints(stored);
      return resolved.resolvedUrl;
    }
    writeStoredEndpoints({ ...stored, [id]: resolved.resolvedUrl });
    return resolved.resolvedUrl;
  }

  const stored = normalizeServiceUrl(readStoredEndpoints()[id] ?? '');
  if (stored) {
    const resolved = serviceEndpointResolution(id, stored, fallback, currentOrigin);
    if (resolved.state === 'misconfigured') {
      clearServiceEndpoint(id);
      return resolved.resolvedUrl;
    }
    return resolved.resolvedUrl;
  }

  const fromEnv = normalizeServiceUrl(envValue ?? '');
  if (fromEnv) return serviceEndpointResolution(id, fromEnv, fallback, currentOrigin).resolvedUrl;

  return normalizeServiceUrl(fallback);
}

export function setServiceEndpoint(id: ServiceId, value: string): string {
  const next = normalizeServiceUrl(value);
  const stored = readStoredEndpoints();
  if (next) stored[id] = next;
  else delete stored[id];
  writeStoredEndpoints(stored);
  return next;
}

export function setServiceEndpoints(endpoints: Partial<Record<ServiceId, string>>): ServiceEndpoint[] {
  const stored = readStoredEndpoints();
  for (const [id, value] of Object.entries(endpoints) as Array<[ServiceId, string | undefined]>) {
    const next = normalizeServiceUrl(value ?? '');
    if (next) stored[id] = next;
    else delete stored[id];
  }
  writeStoredEndpoints(stored);
  return Object.entries(stored).map(([id, url]) => ({ id: id as ServiceId, label: serviceLabels[id as ServiceId], url: url ?? '' }));
}

export function getStoredServiceEndpoints(): ServiceEndpoint[] {
  const stored = readStoredEndpoints();
  return (Object.keys(serviceLabels) as ServiceId[])
    .map((id) => ({ id, label: serviceLabels[id], url: normalizeServiceUrl(stored[id] ?? '') }))
    .filter((endpoint) => endpoint.url);
}

export function serviceEndpointResolutions(): ServiceEndpointResolution[] {
  const currentOrigin = browser && typeof window !== 'undefined' ? window.location.origin : '';
  const stored = readStoredEndpoints();
  return (Object.keys(serviceLabels) as ServiceId[]).map((id) =>
    serviceEndpointResolution(id, stored[id], desktopFallbacks[id], currentOrigin)
  );
}

export function localNetworkHint(): string {
  return 'For full phone access, double-click Start Mini Hub Phone Mode.cmd on the desktop and keep that window open. It starts the API, AI OS, Macro Lab, and hub, then prints/copies a phone URL with the desktop service addresses already filled in.';
}

export function serviceHtmlFallbackMessage(serviceId: ServiceId, path: string, baseUrl: string): string {
  return `${serviceLabels[serviceId]} request ${path} returned the web app HTML instead of JSON. The app is pointed at ${baseUrl}, but that address is serving the static website, not the ${serviceLabels[serviceId]}. ${localNetworkHint()}`;
}

function missingRouteMessage(serviceId: ServiceId, path: string, baseUrl: string): string {
  const expected = desktopFallbacks[serviceId];
  const servicePath = serviceHealthPaths[serviceId];
  const staticHint = looksLikeHostedStaticEndpoint(baseUrl, browser && typeof window !== 'undefined' ? window.location.origin : '')
    ? ' That URL is the hosted Mini Hub website, so browser pages under /api are static-site routes.'
    : '';
  return `${serviceLabels[serviceId]} route ${path} was not found at ${baseUrl}.${staticHint} Check Settings -> Desktop Services and set ${serviceLabels[serviceId]} to ${expected}; its health endpoint should be ${expected}${servicePath}.`;
}

function networkFailureMessage(serviceId: ServiceId, baseUrl: string, detail: string): string {
  const mixedOrCors =
    browser &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//iu.test(baseUrl) &&
    !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/iu.test(baseUrl)
      ? ' This can happen when the hosted HTTPS page is blocked from calling an insecure LAN HTTP endpoint; open the local hub URL printed by the launcher or use a browser-allowed local endpoint.'
      : ' This can also be a CORS, firewall, service-offline, or mixed-content block.';
  return `${serviceLabels[serviceId]} unavailable at ${baseUrl}: ${detail}.${mixedOrCors} ${localNetworkHint()}`;
}

function messageFromJson(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const record = body as { detail?: unknown; error?: unknown; message?: unknown };
  const message = record.detail ?? record.error ?? record.message;
  return typeof message === 'string' ? message.trim() : '';
}

function looksLikeCurrentStaticSite(baseUrl: string): boolean {
  if (!browser) return false;
  const normalized = normalizeServiceUrl(baseUrl);
  try {
    const url = new URL(normalized);
    return normalized === window.location.origin || /github\.io$/iu.test(url.hostname);
  } catch {
    return false;
  }
}

function retryFallbackUrl(serviceId: ServiceId, baseUrl: string): string {
  const fallback = normalizeServiceUrl(desktopFallbacks[serviceId]);
  const normalized = normalizeServiceUrl(baseUrl);
  if (!fallback || fallback === normalized) return '';
  if (serviceId === 'aiOs' || serviceId === 'macroLab') return fallback;
  return looksLikeCurrentStaticSite(baseUrl) ? fallback : '';
}

async function fetchServiceJson<T>(
  serviceId: ServiceId,
  baseUrl: string,
  path: string,
  init: RequestInit,
  options: { credentials?: RequestCredentials; timeoutMs?: number } = {}
): Promise<T> {
  let response: Response;
  const timeoutMs = options.timeoutMs ?? defaultServiceRequestTimeoutMs;
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const upstreamSignal = init.signal;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromUpstream = () => controller?.abort(upstreamSignal?.reason);

  try {
    if (controller) {
      if (upstreamSignal?.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
      }
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: options.credentials,
      signal: controller?.signal ?? init.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    const detail = timedOut ? `request timed out after ${timeoutMs} ms` : error instanceof Error ? error.message : 'network request failed';
    throw new Error(networkFailureMessage(serviceId, baseUrl, detail));
  } finally {
    if (timer) clearTimeout(timer);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  let body: unknown = undefined;

  if (text.trim()) {
    if (!contentType.includes('application/json') && !contentType.includes('+json')) {
      if (text.trimStart().startsWith('<')) throw new Error(serviceHtmlFallbackMessage(serviceId, path, baseUrl));
      if (response.status === 404 || /^not found$/iu.test(text.trim())) throw new Error(missingRouteMessage(serviceId, path, baseUrl));
      throw new Error(`${serviceLabels[serviceId]} request ${path} returned ${contentType || 'non-JSON'} instead of JSON.`);
    }

    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${serviceLabels[serviceId]} request ${path} returned invalid JSON.`);
    }
  }

  if (!response.ok) {
    const message = messageFromJson(body);
    if (response.status === 404 || /^not found$/iu.test(message)) throw new Error(missingRouteMessage(serviceId, path, baseUrl));
    throw new Error(message || `${serviceLabels[serviceId]} request ${path} failed with ${response.status}`);
  }

  return body as T;
}

export async function requestServiceJson<T>(
  serviceId: ServiceId,
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  options: { credentials?: RequestCredentials; timeoutMs?: number } = {}
): Promise<T> {
  try {
    return await fetchServiceJson<T>(serviceId, baseUrl, path, init, options);
  } catch (error) {
    const fallback = retryFallbackUrl(serviceId, baseUrl);
    if (fallback) {
      clearServiceEndpoint(serviceId);
      return fetchServiceJson<T>(serviceId, fallback, path, init, options);
    }
    throw error;
  }
}
