import { describe, expect, it } from 'vitest';
import { classifyServiceIssue, compactServiceIssueLine, isLikelyServiceIssue } from './service-issues';

describe('service issue compaction', () => {
  it('classifies common local-service failures without exposing raw fetch text', () => {
    expect(classifyServiceIssue('AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch.').kind).toBe('offline');
    expect(classifyServiceIssue('AI OS API route /api/ai/research/runs was not found at https://elc9939.github.io/testing.').kind).toBe(
      'wrong-endpoint'
    );
    expect(classifyServiceIssue('The hosted HTTPS page may be blocked from reaching a local HTTP desktop service.').kind).toBe(
      'browser-blocked'
    );
    expect(classifyServiceIssue('request timed out after 15000 ms').kind).toBe('timeout');
  });

  it('turns repeated backend errors into short actionable UI copy', () => {
    expect(compactServiceIssueLine('AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch.', 'AI OS')).toBe(
      'AI OS is offline or unreachable. Start the desktop service, then retry.'
    );
    expect(compactServiceIssueLine('AI OS API route /api/ai/research/runs was not found at https://elc9939.github.io/testing.', 'AI OS')).toBe(
      'AI OS is pointed at the wrong endpoint or a missing route. Open Settings Feature Wiring and check the saved service URL.'
    );
  });

  it('does not mistake ordinary form validation for a service outage', () => {
    expect(isLikelyServiceIssue('Type a research goal before running.')).toBe(false);
    expect(isLikelyServiceIssue('Connect AI OS before running this research task.')).toBe(true);
  });
});
