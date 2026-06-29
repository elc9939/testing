import { describe, expect, it } from 'vitest';
import { hubHref, hubRouteFromPath, legacyHref } from './routes';

describe('hub route helpers', () => {
  it('keeps local hub links root-relative in dev', () => {
    expect(hubHref('/settings')).toBe('/settings');
    expect(hubHref('/settings#data-recovery')).toBe('/settings#data-recovery');
    expect(hubHref('/')).toBe('/');
    expect(hubRouteFromPath('/desk/study')).toBe('/desk/study');
  });

  it('sends the legacy arcade link somewhere reachable in dev', () => {
    expect(legacyHref()).toBe('https://elc9939.github.io/testing/legacy/');
  });
});
