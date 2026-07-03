import { describe, expect, it } from 'vitest';
import { classifyServiceIssue, compactServiceIssueIfRecognized, compactServiceIssueLine, isLikelyServiceIssue } from './service-issues';

describe('service issue compaction', () => {
  it('classifies common local-service failures without exposing raw fetch text', () => {
    expect(classifyServiceIssue('AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch.').kind).toBe('offline');
    expect(classifyServiceIssue('AI OS API route /api/ai/research/runs was not found at https://elc9939.github.io/testing.').kind).toBe(
      'wrong-endpoint'
    );
    expect(classifyServiceIssue('The hosted HTTPS page may be blocked from reaching a local HTTP desktop service.').kind).toBe(
      'browser-blocked'
    );
    expect(
      classifyServiceIssue(
        'AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch. This can also be a CORS, firewall, service-offline, or mixed-content block.'
      ).kind
    ).toBe('offline');
    expect(classifyServiceIssue('request timed out after 15000 ms').kind).toBe('timeout');
    expect(classifyServiceIssue('This operation was aborted').kind).toBe('timeout');
    expect(classifyServiceIssue('Invalid input: expected string, received null').kind).toBe('invalid-response');
    expect(
      classifyServiceIssue(
        "GPU telemetry unavailable: nvidia-smi unavailable: [WinError 2]; Windows GPU telemetry unavailable: Command '['powershell', 'Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine']' timed out"
      ).kind
    ).toBe('telemetry');
  });

  it('turns repeated backend errors into short actionable UI copy', () => {
    expect(compactServiceIssueLine('AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch.', 'AI OS')).toBe(
      'AI OS is offline or unreachable. Start the desktop service, then retry.'
    );
    expect(compactServiceIssueLine('AI OS API route /api/ai/research/runs was not found at https://elc9939.github.io/testing.', 'AI OS')).toBe(
      'AI OS is pointed at the wrong endpoint or a missing route. Open Settings Feature Wiring and check the saved service URL.'
    );
    expect(compactServiceIssueIfRecognized('This operation was aborted', 'AI OS machine profile')).toBe(
      'AI OS machine profile timed out. Cached data stays visible when available; retry after the service settles.'
    );
    expect(
      compactServiceIssueIfRecognized(
        "GPU telemetry unavailable: nvidia-smi unavailable: [WinError 2]; Windows GPU telemetry unavailable: Command '['powershell']' timed out",
        'GPU telemetry'
      )
    ).toBe('GPU telemetry is unavailable. Check AI OS machine profile and Windows/AMD telemetry setup.');
    expect(compactServiceIssueIfRecognized('Invalid input: expected string, received null', 'AI OS')).toBe(
      'AI OS returned data in an unexpected shape. Restart or update the desktop service, then retry.'
    );
  });

  it('does not mistake ordinary form validation for a service outage', () => {
    expect(isLikelyServiceIssue('Type a research goal before running.')).toBe(false);
    expect(isLikelyServiceIssue('Connect AI OS before running this research task.')).toBe(true);
  });

  it('leaves non-service action errors intact while compacting recognized service errors', () => {
    expect(compactServiceIssueIfRecognized('Create a backup before using this action.', 'AI OS')).toBe(
      'Create a backup before using this action.'
    );
    expect(compactServiceIssueIfRecognized('AI OS API unavailable at http://127.0.0.1:8791: Failed to fetch.', 'AI OS')).toBe(
      'AI OS is offline or unreachable. Start the desktop service, then retry.'
    );
  });
});
