import { browser } from '$app/environment';

export type ServiceId = 'hubApi' | 'aiOs' | 'macroLab';

export interface ServiceEndpoint {
  id: ServiceId;
  label: string;
  url: string;
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

export function resolveServiceUrl(id: ServiceId, envValue: string | undefined, fallback: string): string {
  const fromQuery = queryEndpoint(id);
  if (fromQuery) {
    const stored = readStoredEndpoints();
    writeStoredEndpoints({ ...stored, [id]: fromQuery });
    return fromQuery;
  }

  const stored = normalizeServiceUrl(readStoredEndpoints()[id] ?? '');
  if (stored) return stored;

  const fromEnv = normalizeServiceUrl(envValue ?? '');
  if (fromEnv) return fromEnv;

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

export function localNetworkHint(): string {
  return 'For full phone access, double-click Start Mini Hub Phone Mode.cmd on the desktop and keep that window open. It starts the API, AI OS, Macro Lab, and hub, then prints/copies a phone URL with the desktop service addresses already filled in.';
}

export function serviceHtmlFallbackMessage(serviceId: ServiceId, path: string, baseUrl: string): string {
  return `${serviceLabels[serviceId]} request ${path} returned the web app HTML instead of JSON. The app is pointed at ${baseUrl}, but that address is serving the static website, not the ${serviceLabels[serviceId]}. ${localNetworkHint()}`;
}

function messageFromJson(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const record = body as { detail?: unknown; error?: unknown; message?: unknown };
  const message = record.detail ?? record.error ?? record.message;
  return typeof message === 'string' ? message.trim() : '';
}

export async function requestServiceJson<T>(
  serviceId: ServiceId,
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  options: { credentials?: RequestCredentials } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: options.credentials,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network request failed';
    throw new Error(`${serviceLabels[serviceId]} unavailable at ${baseUrl}: ${detail}. ${localNetworkHint()}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  let body: unknown = undefined;

  if (text.trim()) {
    if (!contentType.includes('application/json') && !contentType.includes('+json')) {
      if (text.trimStart().startsWith('<')) throw new Error(serviceHtmlFallbackMessage(serviceId, path, baseUrl));
      throw new Error(`${serviceLabels[serviceId]} request ${path} returned ${contentType || 'non-JSON'} instead of JSON.`);
    }

    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${serviceLabels[serviceId]} request ${path} returned invalid JSON.`);
    }
  }

  if (!response.ok) {
    throw new Error(messageFromJson(body) || `${serviceLabels[serviceId]} request ${path} failed with ${response.status}`);
  }

  return body as T;
}
