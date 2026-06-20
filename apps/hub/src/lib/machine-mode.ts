export type MachineModeId = 'balanced' | 'beast' | 'quiet' | 'offline' | 'night' | 'maintenance';

export interface MachineModeDefinition {
  id: MachineModeId;
  label: string;
  shortLabel: string;
  summary: string;
  routing: string;
  background: string;
  cost: string;
  safety: string;
}

export interface MachineModeContext {
  id: MachineModeId;
  label: string;
  routing: string;
  background: string;
  cost: string;
  safety: string;
  constraints: string[];
}

export const machineModePreferenceKey = 'machineMode';

export const machineModes: MachineModeDefinition[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    shortLabel: 'Balanced',
    summary: 'Use the best available route without being aggressive about GPU-heavy work.',
    routing: 'Prefer local first, allow configured API fallback when useful.',
    background: 'Allow normal background jobs, avoid surprise heavy batches.',
    cost: 'Paid/API fallback is allowed when configured.',
    safety: 'Normal confirmations for write/system actions.'
  },
  {
    id: 'beast',
    label: 'Beast Mode',
    shortLabel: 'Beast',
    summary: 'Favor local compute and GPU-heavy capability when the machine is available.',
    routing: 'Prefer the strongest local route before cloud APIs.',
    background: 'Allow heavy local jobs, benchmarks, indexing, and media work.',
    cost: 'Paid fallback is allowed only after local routes fail or are unsuitable.',
    safety: 'Still require confirmation for write/system/destructive actions.'
  },
  {
    id: 'quiet',
    label: 'Quiet Mode',
    shortLabel: 'Quiet',
    summary: 'Keep the app responsive and avoid noisy, long, or GPU-heavy work.',
    routing: 'Prefer light local models and short calls.',
    background: 'Pause heavy background jobs and defer long batches.',
    cost: 'Avoid paid/API fallback unless explicitly requested.',
    safety: 'Prefer dry runs and small reversible actions.'
  },
  {
    id: 'offline',
    label: 'Offline Mode',
    shortLabel: 'Offline',
    summary: 'Stay local-only and avoid cloud/API work where possible.',
    routing: 'Use local/cache-only routes; do not plan paid/cloud provider calls.',
    background: 'Run only local jobs that do not need network access.',
    cost: 'Never use paid/API fallback unless the user changes mode or explicitly overrides.',
    safety: 'Prefer read-only cache behavior and local dry runs.'
  },
  {
    id: 'night',
    label: 'Night Shift',
    shortLabel: 'Night',
    summary: 'Queue unattended local work for idle time, then report what happened.',
    routing: 'Prefer local/batch-friendly routes and avoid interactive-only tools.',
    background: 'Allow backups, restore tests, indexing, embeddings, summaries, cleanup, and batch analysis.',
    cost: 'Avoid paid/API fallback unless the user explicitly requested a cloud-backed night job.',
    safety: 'Snapshot before risky work and produce a clear morning change report.'
  },
  {
    id: 'maintenance',
    label: 'Maintenance Mode',
    shortLabel: 'Maintenance',
    summary: 'Focus on health checks, backups, restore tests, cleanup, and diagnostics.',
    routing: 'Prefer diagnostic tools over open-ended generation.',
    background: 'Allow maintenance jobs such as backups, verification, indexing, cleanup, and dependency checks.',
    cost: 'Avoid paid/API fallback unless needed to diagnose an explicitly requested service.',
    safety: 'Prefer non-destructive checks; require confirmation before cleanup or repair.'
  }
];

export function normalizeMachineMode(value: unknown): MachineModeId {
  return machineModes.some((mode) => mode.id === value) ? (value as MachineModeId) : 'balanced';
}

export function machineModeFromPreferences(preferences: Record<string, unknown> | null | undefined): MachineModeDefinition {
  return machineModeDefinition(normalizeMachineMode(preferences?.[machineModePreferenceKey]));
}

export function machineModeDefinition(id: MachineModeId): MachineModeDefinition {
  return machineModes.find((mode) => mode.id === id) ?? machineModes[0];
}

export function machineModeContext(id: MachineModeId): MachineModeContext {
  const mode = machineModeDefinition(id);
  const constraints = [mode.routing, mode.background, mode.cost, mode.safety];
  return {
    id: mode.id,
    label: mode.label,
    routing: mode.routing,
    background: mode.background,
    cost: mode.cost,
    safety: mode.safety,
    constraints
  };
}

export function formatMachineModeContext(mode: MachineModeDefinition): string {
  const context = machineModeContext(mode.id);
  return [
    `Machine mode: ${context.label}.`,
    `Routing: ${context.routing}`,
    `Background: ${context.background}`,
    `Cost: ${context.cost}`,
    `Safety: ${context.safety}`
  ].join('\n');
}
