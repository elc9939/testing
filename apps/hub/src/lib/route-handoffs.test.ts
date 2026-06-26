import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function routeSource(routeFile: string): string {
  const file = fileURLToPath(new URL(routeFile, import.meta.url));
  return readFileSync(file, 'utf8');
}

describe('route handoffs', () => {
  it('keeps Passive Tasks activity run links inspectable after navigation', () => {
    const source = routeSource('../routes/passive-tasks/+page.svelte');

    expect(source).toContain("$page.url.searchParams.get('run')");
    expect(source).toContain('Activity: ${highlightedRunId}');
    expect(source).toContain('class:selected={run.id === highlightedRunId}');
    expect(source).toContain('The linked Activity run is not in the latest');
  });

  it('keeps AI OS activity links inspectable after navigation', () => {
    const source = routeSource('../routes/ai-os/+page.svelte');

    expect(source).toContain("$page.url.searchParams.get('activity')");
    expect(source).toContain("$page.url.searchParams.get('job')");
    expect(source).toContain('class:selected={job.id === highlightedJobId}');
    expect(source).toContain('class:selected={run.id === highlightedBenchmarkId}');
    expect(source).toContain('class:selected={backup.id === highlightedBackupId}');
    expect(source).toContain('The linked Activity job is not in the latest');
  });

  it('keeps Research selected reports and monitors recoverable after navigation', () => {
    const source = routeSource('../routes/research/+page.svelte');

    expect(source).toContain('const urlRunId = requestedRunId || requestedResearchRunId()');
    expect(source).toContain('const runId = urlRunId || persistedRunId');
    expect(source).toContain('selectedRunId: selectedRun?.id ?? persistedRunId');
    expect(source).toContain('selectedMonitorId');
    expect(source).toContain('class:selected={monitor.id === selectedMonitorId}');
    expect(source).toContain("monitor.id === selectedMonitorId ? 'Loaded' : 'Load'");
  });
});
