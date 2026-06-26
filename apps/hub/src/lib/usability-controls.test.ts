import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function routeSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('Mini Hub usability control gates', () => {
  it('collapses Research service failures and disables AI OS-backed research actions', async () => {
    const source = await routeSource('../routes/research/+page.svelte');

    expect(source).toContain('serviceIssue = compactResearchServiceIssue');
    expect(source).toContain('class="service-card"');
    expect(source).toContain('disabled={loading || aiOsUnavailable}');
    expect(source).toContain('disabled={monitorsLoading || aiOsUnavailable}');
    expect(source).toContain('disabled={sourceLibraryLoading || aiOsUnavailable}');
    expect(source).toContain('Connect AI OS');
  });

  it('keeps AI Lab classify and parse controls independent', async () => {
    const source = await routeSource('../routes/ai-lab/+page.svelte');

    expect(source).toContain('let classifyBusy = false');
    expect(source).toContain('let parseBusy = false');
    expect(source).toContain('disabled={classifyBusy}');
    expect(source).toContain('disabled={parseBusy}');
    expect(source).toContain('class="result-grid"');
    expect(source).not.toContain('let busy = false');
  });

  it('blocks AI OS service-backed work until a status snapshot is loaded', async () => {
    const source = await routeSource('../routes/ai-os/+page.svelte');

    expect(source).toContain('aiOsActionBlocked = !aiOsReady');
    expect(source).toContain('function requireAiOsReady');
    expect(source).toContain('disabled={commandBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={autotuneBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={designBusy || aiOsActionBlocked}');
    expect(source).toContain('disabled={benchmarkBusy || aiOsActionBlocked}');
  });

  it('guards Macro Lab and Passive task side-effect controls while state is unknown', async () => {
    const macro = await routeSource('../routes/macro-lab/+page.svelte');
    const passive = await routeSource('../routes/passive-tasks/+page.svelte');

    expect(macro).toContain('macroControlDisabled = busy || loading || !macroStateKnown');
    expect(macro).toContain('disabled={macroControlDisabled}');
    expect(passive).toContain('passiveControlDisabled = loading || Boolean(busyId) || !passiveStateKnown');
    expect(passive).toContain('disabled={passiveControlDisabled}');
  });
});
