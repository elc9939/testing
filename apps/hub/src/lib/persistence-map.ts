import { routeMap } from '@mini-hub/core';

export type PersistenceOwner = 'browser' | 'hub-api' | 'ai-os' | 'macro-lab' | 'passive-engine' | 'google';

export interface PersistenceRow {
  id: string;
  feature: string;
  owner: PersistenceOwner;
  savedWhere: string;
  reloadBehavior: string;
  offlineBehavior: string;
  recoveryRoute: string;
  recoveryLabel: string;
  crossDevice: boolean;
}

export const persistenceRows = [
  {
    id: 'today',
    feature: 'Today attention queue',
    owner: 'browser',
    savedWhere: 'Latest attention snapshot is cached in this browser while live sources refresh.',
    reloadBehavior: 'Reopens from cache first, then asks Hub API, Google, AI OS, Macro Lab, and Passive Tasks for fresh rows.',
    offlineBehavior: 'Shows cached or partial source state instead of treating local service failures as a whole-app error.',
    recoveryRoute: routeMap.today,
    recoveryLabel: 'Open Today',
    crossDevice: false
  },
  {
    id: 'activity',
    feature: 'Activity and handoffs',
    owner: 'browser',
    savedWhere: 'Activity records live in their owning services; the combined list and dismissed ids are cached in this browser.',
    reloadBehavior: 'Refresh restores durable research runs, AI OS jobs, passive runs, macro runs, backups, and benchmarks.',
    offlineBehavior: 'Uses cached records when live sources fail and marks source rows stale or partial.',
    recoveryRoute: routeMap.activity,
    recoveryLabel: 'Open Activity',
    crossDevice: false
  },
  {
    id: 'career',
    feature: 'Career Desk',
    owner: 'hub-api',
    savedWhere: 'Jobs are saved through the Hub API into the personal workspace and mirrored into the browser cache.',
    reloadBehavior: 'Jobs, filters, and view state rehydrate from API/cache/browser storage after navigation or reload.',
    offlineBehavior: 'Cached jobs remain readable; add/edit/delete controls are disabled until the Hub API is online.',
    recoveryRoute: routeMap.careerDesk,
    recoveryLabel: 'Open Career',
    crossDevice: true
  },
  {
    id: 'study',
    feature: 'Study Desk',
    owner: 'hub-api',
    savedWhere: 'Study sessions are saved through the Hub API into the personal workspace and mirrored into the browser cache.',
    reloadBehavior: 'Logs, quick-log defaults, filters, progress, and analytics rehydrate after navigation or reload.',
    offlineBehavior: 'Cached sessions remain readable; logging and edits are disabled until the Hub API is online.',
    recoveryRoute: routeMap.studyDesk,
    recoveryLabel: 'Open Study',
    crossDevice: true
  },
  {
    id: 'productivity',
    feature: 'Productivity Hub',
    owner: 'google',
    savedWhere: 'Google account grants live in the local Hub API; calendar, mail, labels, and filters are cached in this browser.',
    reloadBehavior: 'Calendar boards, Gmail summaries, selected filters, and connected account state reload from cache then refresh.',
    offlineBehavior: 'Cached mail/calendar can remain visible; Gmail and Calendar writes are disabled until API and Google are ready.',
    recoveryRoute: routeMap.productivity,
    recoveryLabel: 'Open Productivity',
    crossDevice: false
  },
  {
    id: 'research',
    feature: 'Research Desk',
    owner: 'ai-os',
    savedWhere: 'Runs, reports, monitors, sources, and exports live in AI OS storage; drafts live in browser storage.',
    reloadBehavior: 'The page restores the requested, selected, or latest recoverable run and polls queued/running/paused runs.',
    offlineBehavior: 'AI OS-backed buttons are disabled and point to Settings; browser drafts remain visible.',
    recoveryRoute: routeMap.research,
    recoveryLabel: 'Open Research',
    crossDevice: false
  },
  {
    id: 'ai-os',
    feature: 'AI OS',
    owner: 'ai-os',
    savedWhere: 'Jobs, usage logs, benchmarks, machine snapshots, backups, tools, and generated assets live in AI OS storage.',
    reloadBehavior: 'Status, jobs, activity, machine profile, and logs reload from the AI OS API when reachable.',
    offlineBehavior: 'Service-backed controls are disabled; Settings shows the endpoint and health target to repair.',
    recoveryRoute: routeMap.aiOs,
    recoveryLabel: 'Open AI OS',
    crossDevice: false
  },
  {
    id: 'macro-lab',
    feature: 'Macro Lab',
    owner: 'macro-lab',
    savedWhere: 'Macros, triggers, run history, panic state, and recovery artifacts live in the Macro Lab service.',
    reloadBehavior: 'Status, history, triggers, and selected Activity links reload from the Macro Lab API.',
    offlineBehavior: 'Run, reset, panic, and trigger controls stay disabled until Macro Lab state is known.',
    recoveryRoute: routeMap.macroLab,
    recoveryLabel: 'Open Macros',
    crossDevice: false
  },
  {
    id: 'passive-tasks',
    feature: 'Passive Tasks',
    owner: 'passive-engine',
    savedWhere: 'Worker settings, watchers, runs, notifications, digests, and restore-point metadata live in the Hub API.',
    reloadBehavior: 'Dashboard and Activity reload worker state, recent runs, and digest cards from backend state.',
    offlineBehavior: 'Manual run/toggle/triage controls stay disabled until the passive snapshot and settings load.',
    recoveryRoute: routeMap.passiveTasks,
    recoveryLabel: 'Open Passive',
    crossDevice: true
  },
  {
    id: 'ai-lab',
    feature: 'AI Lab',
    owner: 'browser',
    savedWhere: 'Browser-local sample inputs, labels, code, and grammar URL are stored in localStorage.',
    reloadBehavior: 'Inputs rehydrate on reload; classify and parse results are intentionally ad hoc test output.',
    offlineBehavior: 'Works without AI OS, but model or WASM asset failures are shown in the relevant panel.',
    recoveryRoute: routeMap.aiLab,
    recoveryLabel: 'Open AI Lab',
    crossDevice: false
  },
  {
    id: 'games',
    feature: 'Games and labs',
    owner: 'hub-api',
    savedWhere: 'Supported game runs and state save through the Hub API; legacy/playground state may remain browser-local.',
    reloadBehavior: 'Playable pages reload locally; supported high scores and runs rehydrate from cache/API when available.',
    offlineBehavior: 'Games stay playable where possible; API-backed save controls explain offline read-only state.',
    recoveryRoute: routeMap.games,
    recoveryLabel: 'Open Games',
    crossDevice: true
  }
] as const satisfies readonly PersistenceRow[];

export function persistenceOwnerLabel(owner: PersistenceOwner): string {
  if (owner === 'hub-api') return 'Hub API';
  if (owner === 'ai-os') return 'AI OS';
  if (owner === 'macro-lab') return 'Macro Lab';
  if (owner === 'passive-engine') return 'Passive Engine';
  if (owner === 'google') return 'Google + Hub API';
  return 'Browser';
}

export function persistenceSummary(rows: readonly PersistenceRow[] = persistenceRows): {
  total: number;
  crossDevice: number;
  browserLocal: number;
  serviceBacked: number;
} {
  return {
    total: rows.length,
    crossDevice: rows.filter((row) => row.crossDevice).length,
    browserLocal: rows.filter((row) => row.owner === 'browser').length,
    serviceBacked: rows.filter((row) => row.owner !== 'browser').length
  };
}
