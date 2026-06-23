import { routeMap } from '@mini-hub/core';
import type { ServiceEndpointResolution, ServiceId } from './service-config';
import { serviceHealthPath } from './service-config';

export type FeatureWiringStatus = 'ready' | 'checking' | 'offline' | 'misconfigured' | 'needs_setup' | 'unknown';

export interface FeatureWiringSignal {
  ready?: boolean;
  loading?: boolean;
  error?: string;
  setupNeeded?: boolean;
  detail?: string;
  fixAction?: string;
}

export interface FeatureWiringRow {
  id: string;
  feature: string;
  requiredService: string;
  endpoint: string;
  status: FeatureWiringStatus;
  detail: string;
  fixAction: string;
  route: string;
  healthUrl?: string;
  lastCheckedAt?: string;
}

export interface FeatureWiringInput {
  checkedAt?: string;
  endpoints: ServiceEndpointResolution[];
  hubApi: FeatureWiringSignal;
  aiOs: FeatureWiringSignal;
  macroLab: FeatureWiringSignal;
  google: FeatureWiringSignal;
  passiveTasks: FeatureWiringSignal;
  browserStorage: FeatureWiringSignal;
}

export function buildFeatureWiringRows(input: FeatureWiringInput): FeatureWiringRow[] {
  const endpointById = new Map(input.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const hubEndpoint = endpointById.get('hubApi');
  const aiEndpoint = endpointById.get('aiOs');
  const macroEndpoint = endpointById.get('macroLab');

  return [
    serviceRow({
      id: 'hub-api',
      feature: 'Mini Hub API',
      requiredService: 'Hub API',
      route: routeMap.settings,
      endpoint: hubEndpoint,
      signal: input.hubApi,
      checkedAt: input.checkedAt
    }),
    serviceRow({
      id: 'ai-os-api',
      feature: 'AI OS API',
      requiredService: 'FastAPI + Ollama layer',
      route: routeMap.aiOs,
      endpoint: aiEndpoint,
      signal: input.aiOs,
      checkedAt: input.checkedAt
    }),
    serviceRow({
      id: 'research-endpoints',
      feature: 'Research Desk',
      requiredService: 'AI OS research routes',
      route: routeMap.research,
      endpoint: aiEndpoint,
      signal: input.aiOs.ready ? { ...input.aiOs, detail: 'Research uses AI OS /api/ai/research routes.' } : input.aiOs,
      endpointSuffix: '/api/ai/research/*',
      checkedAt: input.checkedAt
    }),
    serviceRow({
      id: 'macro-lab-api',
      feature: 'Macro Lab',
      requiredService: 'Macro Lab API',
      route: routeMap.macroLab,
      endpoint: macroEndpoint,
      signal: input.macroLab,
      checkedAt: input.checkedAt
    }),
    serviceRow({
      id: 'google-integrations',
      feature: 'Google Mail + Calendar',
      requiredService: 'Hub API + Google OAuth',
      route: routeMap.productivity,
      endpoint: hubEndpoint,
      signal: input.google,
      endpointSuffix: '/api/integrations/google/*',
      checkedAt: input.checkedAt
    }),
    serviceRow({
      id: 'passive-tasks',
      feature: 'Passive Tasks',
      requiredService: 'Hub API passive engine',
      route: routeMap.passiveTasks,
      endpoint: hubEndpoint,
      signal: input.passiveTasks,
      endpointSuffix: '/api/passive/*',
      checkedAt: input.checkedAt
    }),
    localRow(input.browserStorage, input.checkedAt)
  ];
}

export function featureWiringStatusLabel(status: FeatureWiringStatus): string {
  if (status === 'needs_setup') return 'Needs setup';
  if (status === 'misconfigured') return 'Misconfigured';
  if (status === 'checking') return 'Checking';
  if (status === 'offline') return 'Offline';
  if (status === 'ready') return 'Ready';
  return 'Unknown';
}

function serviceRow(input: {
  id: string;
  feature: string;
  requiredService: string;
  route: string;
  endpoint?: ServiceEndpointResolution;
  signal: FeatureWiringSignal;
  endpointSuffix?: string;
  checkedAt?: string;
}): FeatureWiringRow {
  const status = serviceStatus(input.endpoint, input.signal);
  const endpointBase = input.endpoint?.resolvedUrl || input.endpoint?.requestedUrl || '';
  const endpoint = endpointBase ? `${endpointBase}${input.endpointSuffix ?? ''}` : 'Not configured';
  const detail = rowDetail(status, input.endpoint, input.signal);
  const fixAction = rowFixAction(status, input.endpoint, input.signal);
  return {
    id: input.id,
    feature: input.feature,
    requiredService: input.requiredService,
    endpoint,
    status,
    detail,
    fixAction,
    route: input.route,
    healthUrl: healthUrl(input.endpoint),
    lastCheckedAt: input.checkedAt
  };
}

function localRow(signal: FeatureWiringSignal, checkedAt?: string): FeatureWiringRow {
  const status = signal.loading ? 'checking' : signal.error ? 'offline' : signal.ready ? 'ready' : 'needs_setup';
  return {
    id: 'browser-storage',
    feature: 'Browser cache',
    requiredService: 'localStorage + IndexedDB/PGlite',
    endpoint: 'browser://local-storage',
    status,
    detail: signal.detail || signal.error || (status === 'ready' ? 'Browser storage is writable for drafts, cached activity, and local-first reads.' : 'Browser storage is unavailable.'),
    fixAction: signal.fixAction || (status === 'ready' ? 'No action needed.' : 'Check browser privacy/storage settings and reload.'),
    route: routeMap.settings,
    lastCheckedAt: checkedAt
  };
}

function serviceStatus(endpoint: ServiceEndpointResolution | undefined, signal: FeatureWiringSignal): FeatureWiringStatus {
  if (endpoint?.state === 'misconfigured') return 'misconfigured';
  if (signal.loading) return 'checking';
  if (signal.error) return 'offline';
  if (signal.ready) return 'ready';
  if (signal.setupNeeded) return 'needs_setup';
  return 'unknown';
}

function rowDetail(
  status: FeatureWiringStatus,
  endpoint: ServiceEndpointResolution | undefined,
  signal: FeatureWiringSignal
): string {
  if (status === 'misconfigured') return endpoint?.detail ?? 'Endpoint points at the wrong service.';
  if (status === 'checking') return 'A service check is running.';
  if (status === 'offline') return signal.error ?? 'The service is not reachable from this browser.';
  if (status === 'needs_setup') return signal.detail ?? 'This feature needs setup before it can show connected data.';
  if (status === 'ready') return signal.detail ?? 'This feature is connected and ready.';
  return endpoint?.detail ?? signal.detail ?? 'Click Check Services to verify this feature.';
}

function rowFixAction(
  status: FeatureWiringStatus,
  endpoint: ServiceEndpointResolution | undefined,
  signal: FeatureWiringSignal
): string {
  if (status === 'misconfigured') return endpoint?.fixAction ?? 'Save the correct service URL in Settings.';
  if (status === 'checking') return 'Wait for the current service check to finish.';
  if (status === 'offline') return signal.fixAction ?? endpoint?.fixAction ?? 'Start the service and retry.';
  if (status === 'needs_setup') return signal.fixAction ?? 'Open the feature and complete setup.';
  if (status === 'ready') return 'No action needed.';
  return signal.fixAction ?? endpoint?.fixAction ?? 'Run Check Services.';
}

function healthUrl(endpoint: ServiceEndpointResolution | undefined): string | undefined {
  if (!endpoint?.resolvedUrl) return undefined;
  return `${endpoint.resolvedUrl}${serviceHealthPath(endpoint.id as ServiceId)}`;
}
