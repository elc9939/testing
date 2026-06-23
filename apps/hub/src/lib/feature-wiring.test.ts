import { describe, expect, it } from 'vitest';
import { buildFeatureWiringRows, featureWiringStatusLabel } from './feature-wiring';
import { serviceEndpointResolution, serviceFallbackUrl, type ServiceId } from './service-config';

function endpoint(id: ServiceId, value: string) {
  return serviceEndpointResolution(id, value, serviceFallbackUrl(id), 'https://elc9939.github.io');
}

describe('feature wiring diagnostics', () => {
  it('surfaces hosted/static API targets as misconfigured feature rows', () => {
    const rows = buildFeatureWiringRows({
      checkedAt: '2026-06-23T10:00:00.000Z',
      endpoints: [
        endpoint('hubApi', 'http://127.0.0.1:8787'),
        endpoint('aiOs', 'https://elc9939.github.io/testing'),
        endpoint('macroLab', 'http://127.0.0.1:8792')
      ],
      hubApi: { ready: true },
      aiOs: { ready: false },
      macroLab: { ready: true },
      google: { setupNeeded: true },
      passiveTasks: { ready: true },
      browserStorage: { ready: true }
    });

    expect(rows.find((row) => row.id === 'ai-os-api')).toMatchObject({
      status: 'misconfigured',
      endpoint: 'http://127.0.0.1:8791'
    });
    expect(rows.find((row) => row.id === 'research-endpoints')?.status).toBe('misconfigured');
  });

  it('keeps Google distinct from API health so setup is clear', () => {
    const rows = buildFeatureWiringRows({
      endpoints: [
        endpoint('hubApi', 'http://127.0.0.1:8787'),
        endpoint('aiOs', 'http://127.0.0.1:8791'),
        endpoint('macroLab', 'http://127.0.0.1:8792')
      ],
      hubApi: { ready: true },
      aiOs: { ready: true },
      macroLab: { ready: true },
      google: { setupNeeded: true, detail: 'No Google account is connected.' },
      passiveTasks: { error: 'Passive task route failed.' },
      browserStorage: { ready: true }
    });

    expect(rows.find((row) => row.id === 'google-integrations')).toMatchObject({
      status: 'needs_setup',
      route: '/productivity'
    });
    expect(rows.find((row) => row.id === 'passive-tasks')?.status).toBe('offline');
    expect(featureWiringStatusLabel('needs_setup')).toBe('Needs setup');
  });
});
