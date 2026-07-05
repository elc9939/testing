import { browser } from '$app/environment';

export type ServiceId = 'hubApi' | 'aiOs' | 'macroLab' | 'ollama';

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

export type ConnectionModeId = 'local-full-power' | 'private-remote' | 'hosted-light';

export interface ConnectionMode {
  id: ConnectionModeId;
  label: string;
  summary: string;
  detail: string;
  setupAction: string;
  fullPower: boolean;
}

export interface PrivateRemoteLink {
  label: string;
  host: string;
  url: string;
  detail: string;
}

const storageKey = 'miniHub.serviceEndpoints.v1';
const bridgeTokenStorageKey = 'miniHub.bridgeToken.v1';

const queryNames: Record<ServiceId, string[]> = {
  hubApi: ['apiUrl', 'hubApiUrl'],
  aiOs: ['aiOsUrl', 'aiOsApiUrl'],
  macroLab: ['macroLabUrl', 'macroLabApiUrl'],
  ollama: ['ollamaUrl', 'ollamaBaseUrl']
};

const serviceLabels: Record<ServiceId, string> = {
  hubApi: 'Mini Hub API',
  aiOs: 'AI OS API',
  macroLab: 'Macro Lab API',
  ollama: 'Ollama'
};

const desktopFallbacks: Record<ServiceId, string> = {
  hubApi: 'http://127.0.0.1:8787',
  aiOs: 'http://127.0.0.1:8791',
  macroLab: 'http://127.0.0.1:8792',
  ollama: 'http://127.0.0.1:11434'
};

const serviceHealthPaths: Record<ServiceId, string> = {
  hubApi: '/api/health',
  aiOs: '/api/ai/health',
  macroLab: '/api/macro-lab/health',
  ollama: '/api/tags'
};

const servicePorts: Record<ServiceId, number> = {
  hubApi: 8787,
  aiOs: 8791,
  macroLab: 8792,
  ollama: 11434
};

export const defaultServiceRequestTimeoutMs = 15_000;

function getBrowserStorage(): Storage | null {
  if (!browser) return null;
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStoredEndpoints(): Partial<Record<ServiceId, string>> {
  const storage = getBrowserStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<Record<ServiceId, string>>) : {};
  } catch {
    return {};
  }
}

function writeStoredEndpoints(endpoints: Partial<Record<ServiceId, string>>): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(endpoints));
  } catch {
    // Endpoint persistence is best-effort; callers still use defaults and Settings diagnostics.
  }
}

function endpointsFromStored(stored: Partial<Record<ServiceId, string>>): ServiceEndpoint[] {
  return (Object.keys(serviceLabels) as ServiceId[])
    .map((id) => ({ id, label: serviceLabels[id], url: normalizeServiceUrl(stored[id] ?? '') }))
    .filter((endpoint) => endpoint.url);
}

function queryEndpoint(id: ServiceId): string {
  if (!browser || typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  for (const name of queryNames[id]) {
    const value = normalizeServiceUrl(params.get(name) ?? '');
    if (value) return value;
  }
  return '';
}

export function applyQueryServiceEndpoints(): ServiceEndpoint[] {
  if (!browser) return endpointsFromStored(readStoredEndpoints());
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const stored = readStoredEndpoints();
  let changed = false;

  for (const id of Object.keys(serviceLabels) as ServiceId[]) {
    const fromQuery = queryEndpoint(id);
    if (!fromQuery) continue;
    const resolved = serviceEndpointResolution(id, fromQuery, desktopFallbacks[id], currentOrigin);
    if (resolved.state === 'misconfigured') {
      if (stored[id]) {
        delete stored[id];
        changed = true;
      }
      continue;
    }
    if (stored[id] !== resolved.resolvedUrl) {
      stored[id] = resolved.resolvedUrl;
      changed = true;
    }
  }

  if (changed) writeStoredEndpoints(stored);
  return endpointsFromStored(stored);
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

export function servicePort(id: ServiceId): number {
  return servicePorts[id];
}

function parseUrlOrigin(value: string): URL | null {
  const normalized = normalizeServiceUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function isGithubPagesHost(hostname: string): boolean {
  return /(?:^|\.)github\.io$/iu.test(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  return (
    /\.ts\.net$/iu.test(hostname) ||
    /\.(?:local|lan|home)$/iu.test(hostname) ||
    (!hostname.includes('.') && !isGithubPagesHost(hostname))
  );
}

function isPrivateRemoteHost(hostname: string): boolean {
  if (isLoopbackHost(hostname)) return false;
  return isPrivateIpv4(hostname) || isPrivateHostname(hostname);
}

export function connectionModeForOrigin(origin: string): ConnectionMode {
  const parsed = parseUrlOrigin(origin);
  const hostname = parsed?.hostname ?? '';
  if (hostname && isLoopbackHost(hostname)) {
    return {
      id: 'local-full-power',
      label: 'Local Full Power',
      summary: 'This browser is on the Windows PC that hosts Mini Hub services.',
      detail: 'Use this mode for the most reliable AI OS, Ollama, Macro Lab, GPU telemetry, Google, and data-sync behavior.',
      setupAction: 'Keep the local launcher or dev terminals running.',
      fullPower: true
    };
  }
  if (hostname && isPrivateRemoteHost(hostname)) {
    return {
      id: 'private-remote',
      label: 'Private Remote',
      summary: 'This browser appears to be reaching your PC through a LAN or Tailscale-style private address.',
      detail: 'Full-power features can work if the desktop stack is running, the PC is awake, and this origin is trusted by each local service.',
      setupAction: 'Use the matching private host for Hub API, AI OS, and Macro Lab service URLs, then run Check Services.',
      fullPower: true
    };
  }
  return {
    id: 'hosted-light',
    label: 'Hosted Light',
    summary: 'This browser is on a public/static origin such as GitHub Pages.',
    detail: 'The static site can show browser-local and cached state, but heavy local services only work when reachable through saved private endpoints.',
    setupAction: 'Open Local Full Power on the PC or configure private remote endpoints from Settings.',
    fullPower: false
  };
}

export function buildServiceUrlFromHubOrigin(id: ServiceId, origin: string): string {
  const parsed = parseUrlOrigin(origin);
  if (!parsed || isGithubPagesHost(parsed.hostname)) return '';
  if (parsed.port === '5173' || parsed.port === '') return parsed.origin;
  const protocol = parsed.protocol === 'https:' ? 'http:' : parsed.protocol || 'http:';
  return `${protocol}//${parsed.hostname}:${servicePorts[id]}`;
}

function hostFromPrivateTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//iu, '').replace(/\/.*$/u, '').replace(/:\d+$/u, '');
  }
}

export function buildPrivateRemoteBridgeLink(hostValue: string): string {
  const host = hostFromPrivateTarget(hostValue);
  if (!host) return '';
  const hubUrl = `http://${host}:5173/`;
  const params = new URLSearchParams({
    apiUrl: `http://${host}:8787`,
    aiOsUrl: `http://${host}:8791`,
    macroLabUrl: `http://${host}:8792`,
    ollamaUrl: `http://${host}:11434`
  });
  return `${hubUrl}?${params.toString()}`;
}

export function buildPrivateRemoteGatewayLink(hostValue: string): string {
  const host = hostFromPrivateTarget(hostValue);
  if (!host) return '';
  const gatewayUrl = `http://${host}:5173`;
  const params = new URLSearchParams({
    apiUrl: gatewayUrl,
    aiOsUrl: gatewayUrl,
    macroLabUrl: gatewayUrl,
    ollamaUrl: gatewayUrl,
    gateway: 'single-port'
  });
  return `${gatewayUrl}/?${params.toString()}`;
}

export function privateRemoteLinks(origin: string, lanIpv4: string[] = []): PrivateRemoteLink[] {
  const links: PrivateRemoteLink[] = [];
  const seen = new Set<string>();

  function add(hostValue: string, label: string, detail: string): void {
    const host = hostFromPrivateTarget(hostValue);
    if (!host || seen.has(host) || isLoopbackHost(host) || isGithubPagesHost(host)) return;
    seen.add(host);
    links.push({ label, host, url: buildPrivateRemoteGatewayLink(host), detail });
  }

  const parsed = parseUrlOrigin(origin);
  if (parsed && isPrivateRemoteHost(parsed.hostname)) {
    add(parsed.hostname, 'Current private host', 'Use this when the page is already open through LAN, Tailscale, or another private host.');
  }

  for (const address of lanIpv4) {
    add(address, 'Detected LAN phone link', 'Use this on your phone while it is on the same Wi-Fi or private LAN as the PC.');
  }

  return links;
}

export function remoteEndpointSuggestions(origin: string): ServiceEndpoint[] {
  const parsed = parseUrlOrigin(origin);
  if (!parsed || isGithubPagesHost(parsed.hostname)) return [];
  return (Object.keys(serviceLabels) as ServiceId[]).map((id) => ({
    id,
    label: serviceLabels[id],
    url: buildServiceUrlFromHubOrigin(id, origin)
  }));
}

export function looksLikeHostedStaticEndpoint(value: string, currentOrigin = ''): boolean {
  const normalized = normalizeServiceUrl(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    if (/github\.io$/iu.test(url.hostname)) return true;
    if (!currentOrigin || normalized !== normalizeServiceUrl(currentOrigin)) return false;
    const current = new URL(normalizeServiceUrl(currentOrigin));
    return isGithubPagesHost(current.hostname);
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

export function getBridgeToken(): string {
  const storage = getBrowserStorage();
  if (!storage) return '';
  try {
    return storage.getItem(bridgeTokenStorageKey)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setBridgeToken(value: string): string {
  const next = value.trim();
  const storage = getBrowserStorage();
  if (!storage) return next;
  try {
    if (next) storage.setItem(bridgeTokenStorageKey, next);
    else storage.removeItem(bridgeTokenStorageKey);
  } catch {
    // Bridge token persistence is best-effort; Settings diagnostics will still explain the missing token.
  }
  return next;
}

export function clearBridgeToken(): void {
  setBridgeToken('');
}

export function bridgeTokenConfigured(): boolean {
  return Boolean(getBridgeToken());
}

export function bridgeAuthHeaders(serviceId: ServiceId): Record<string, string> {
  if (serviceId === 'ollama') return {};
  const token = getBridgeToken();
  return token ? { 'X-Mini-Hub-Bridge-Token': token } : {};
}

export function getStoredServiceEndpoints(): ServiceEndpoint[] {
  applyQueryServiceEndpoints();
  return endpointsFromStored(readStoredEndpoints());
}

export function serviceEndpointResolutions(): ServiceEndpointResolution[] {
  const currentOrigin = browser && typeof window !== 'undefined' ? window.location.origin : '';
  applyQueryServiceEndpoints();
  const stored = readStoredEndpoints();
  return (Object.keys(serviceLabels) as ServiceId[]).map((id) =>
    serviceEndpointResolution(id, stored[id], desktopFallbacks[id], currentOrigin)
  );
}

export function localNetworkHint(): string {
  return 'For full private-network access, run pnpm bridge:start:lan and keep the PC awake. Use pnpm bridge:startup:install:lan if the bridge should start after Windows login. The bridge checks Mini Hub API, AI OS, Macro Lab, Ollama, and the hub, then writes bridge-link.txt with a single-port gateway URL; the Hub UI proxies service calls back to localhost on the PC. For Tailscale, run scripts/mini-hub-bridge.ps1 start -Profile lan -HubUi -RemoteHost <pc-name-or-100.x-ip>. GitHub Pages is only the static shell; use the private hub URL or an HTTPS tunnel/proxy when browser mixed-content rules block HTTPS-to-HTTP service calls.';
}

export function serviceHtmlFallbackMessage(serviceId: ServiceId, path: string, baseUrl: string, expected = 'JSON'): string {
  return `${serviceLabels[serviceId]} request ${path} returned the web app HTML instead of ${expected}. The app is pointed at ${baseUrl}, but that address is serving the static website, not the ${serviceLabels[serviceId]}. ${localNetworkHint()}`;
}

function missingRouteMessage(serviceId: ServiceId, path: string, baseUrl: string): string {
  const expected = desktopFallbacks[serviceId];
  const servicePath = serviceHealthPaths[serviceId];
  const staticHint = looksLikeHostedStaticEndpoint(baseUrl, browser && typeof window !== 'undefined' ? window.location.origin : '')
    ? ' That URL is the hosted Mini Hub website, so browser pages under /api are static-site routes.'
    : '';
  return `${serviceLabels[serviceId]} route ${path} was not found at ${baseUrl}.${staticHint} Check Settings -> Desktop Services and set ${serviceLabels[serviceId]} to ${expected}; its health endpoint should be ${expected}${servicePath}.`;
}

export function serviceNetworkContextHint(baseUrl: string, pageProtocol = browser && typeof window !== 'undefined' ? window.location.protocol : ''): string {
  const isInsecureHttp = /^http:\/\//iu.test(baseUrl);
  const isLocalDesktopEndpoint = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/iu.test(baseUrl);
  if (pageProtocol === 'https:' && isInsecureHttp && isLocalDesktopEndpoint) {
    return ' The hosted HTTPS page may be blocked from reaching a local HTTP desktop service in this browser; open the local hub URL printed by the launcher, or use Settings from that local page.';
  }
  if (pageProtocol === 'https:' && isInsecureHttp) {
    return ' This can happen when the hosted HTTPS page is blocked from calling an insecure LAN HTTP endpoint; open the local hub URL printed by the launcher or use a browser-allowed local endpoint.';
  }
  return ' This can also be a CORS, firewall, service-offline, or mixed-content block.';
}

function networkFailureMessage(serviceId: ServiceId, baseUrl: string, detail: string): string {
  return `${serviceLabels[serviceId]} unavailable at ${baseUrl}: ${detail}.${serviceNetworkContextHint(baseUrl)} ${localNetworkHint()}`;
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
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        accept: 'application/json',
        ...bridgeAuthHeaders(serviceId),
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

async function fetchServiceResponse(
  serviceId: ServiceId,
  baseUrl: string,
  path: string,
  init: RequestInit,
  options: { credentials?: RequestCredentials; timeoutMs?: number } = {}
): Promise<Response> {
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
        accept: 'application/json',
        ...bridgeAuthHeaders(serviceId),
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
  if (response.ok && /text\/html/iu.test(contentType)) throw new Error(serviceHtmlFallbackMessage(serviceId, path, baseUrl, 'events'));
  if (response.ok) return response;

  const text = await response.text().catch(() => '');
  if (text.trimStart().startsWith('<')) throw new Error(serviceHtmlFallbackMessage(serviceId, path, baseUrl, 'events'));
  if (response.status === 404 || /^not found$/iu.test(text.trim())) throw new Error(missingRouteMessage(serviceId, path, baseUrl));

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      const message = messageFromJson(JSON.parse(text) as unknown);
      if (response.status === 404 || /^not found$/iu.test(message)) throw new Error(missingRouteMessage(serviceId, path, baseUrl));
      throw new Error(message || `${serviceLabels[serviceId]} request ${path} failed with ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
    }
  }

  throw new Error(`${serviceLabels[serviceId]} request ${path} failed with ${response.status}`);
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

export async function requestServiceResponse(
  serviceId: ServiceId,
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  options: { credentials?: RequestCredentials; timeoutMs?: number } = {}
): Promise<Response> {
  try {
    return await fetchServiceResponse(serviceId, baseUrl, path, init, options);
  } catch (error) {
    const fallback = retryFallbackUrl(serviceId, baseUrl);
    if (fallback) {
      clearServiceEndpoint(serviceId);
      return fetchServiceResponse(serviceId, fallback, path, init, options);
    }
    throw error;
  }
}
