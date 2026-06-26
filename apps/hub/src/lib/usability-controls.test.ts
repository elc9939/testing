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

  it('keeps Productivity Google writes guarded while cached data remains inspectable', async () => {
    const source = await routeSource('../routes/productivity/+page.svelte');

    expect(source).toContain('productivityReady = canAct && googleConnected');
    expect(source).toContain('if (!productivityReady) return;');
    expect(source).toContain('disabled={!productivityReady}');
    expect(source).toContain('cached productivity data can stay visible');
    expect(source).toContain('hubHref(routeMap.settings)');
    expect(source).toContain('disabled={loading || backgroundRefreshing}');
  });

  it('makes Activity recovery state scannable instead of one vague active count', async () => {
    const source = await routeSource('../routes/activity/+page.svelte');

    expect(source).toContain('runningRecords');
    expect(source).toContain('pausedRecords');
    expect(source).toContain('sourceFailures');
    expect(source).toContain('<span>Dismissed</span>');
    expect(source).toContain('showing cached records from');
    expect(source).toContain('one source failed; available work is still listed');
  });

  it('keeps Career and Study inline edits read-only when save capability drops', async () => {
    const career = await routeSource('../routes/desk/career/+page.svelte');
    const study = await routeSource('../routes/desk/study/+page.svelte');

    expect(career).toContain('if (!canSave || saving || !company.trim() || !role.trim()) return');
    expect(career).toContain('if (!canSave || editingJobId || rowBusyId) return');
    expect(career).toContain('if (!canSave || !jobDraft.company.trim() || !jobDraft.role.trim()) return');
    expect(career).toContain('disabled={!canSave || rowBusyId === job.id}');
    expect(study).toContain('if (!canSave || saving || !subject.trim() || minutes < 1) return');
    expect(study).toContain('if (!canSave || saving) return');
    expect(study).toContain('if (!canSave || editingSessionId || rowBusyId) return');
    expect(study).toContain('disabled={!canSave || rowBusyId === log.id}');
  });

  it('keeps the hub smoke script able to print a repeatable action and reload checklist', async () => {
    const source = await routeSource('../../../../scripts/hub-usability-smoke.mjs');

    expect(source).toContain('function printChecklist');
    expect(source).toContain("args.has('--checklist')");
    expect(source).toContain('Exercise safe action');
    expect(source).toContain('verify persistence');
    expect(source).toContain('expectedBlockedState');
  });
});
