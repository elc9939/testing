import type { CapabilityRegistryEntry, CapabilityRegistrySnapshot } from './capability-registry';
import type { MachineModeDefinition } from './machine-mode';

export interface ModeRecommendation {
  id: string;
  label: string;
  detail: string;
  route: string;
  tag: string;
  priority: number;
  capabilityId?: string;
  action?: ModeRecommendationAction;
}

export type ModeRecommendationActionKind = 'run_text_benchmark' | 'run_foundation_check' | 'queue_local_summary_batch';

export interface ModeRecommendationAction {
  kind: ModeRecommendationActionKind;
  label: string;
  confirm?: string;
}

interface ModeRecommendationInput {
  mode: MachineModeDefinition;
  capabilitySnapshot: CapabilityRegistrySnapshot | null;
  attentionCount?: number;
}

function ready(capability: CapabilityRegistryEntry | undefined): boolean {
  return Boolean(capability?.available && ['ready', 'running'].includes(capability.state));
}

function needsWork(capability: CapabilityRegistryEntry | undefined): boolean {
  return Boolean(capability && !['ready', 'running'].includes(capability.state));
}

function capability(snapshot: CapabilityRegistrySnapshot, id: string): CapabilityRegistryEntry | undefined {
  return snapshot.capabilities.find((item) => item.id === id);
}

function firstIssue(snapshot: CapabilityRegistrySnapshot): CapabilityRegistryEntry | undefined {
  return snapshot.capabilities
    .filter((item) => !['ready', 'running'].includes(item.state))
    .sort((a, b) => issueRank(b) - issueRank(a) || a.label.localeCompare(b.label))[0];
}

function issueRank(capability: CapabilityRegistryEntry): number {
  if (capability.state === 'offline') return 6;
  if (capability.state === 'blocked') return 5;
  if (capability.state === 'degraded') return 4;
  if (capability.state === 'needs_setup') return 3;
  return 0;
}

function rec(
  id: string,
  label: string,
  detail: string,
  route: string,
  tag: string,
  priority: number,
  capabilityId?: string
): ModeRecommendation {
  return { id, label, detail, route, tag, priority, capabilityId };
}

function withAction(recommendation: ModeRecommendation, action: ModeRecommendationAction): ModeRecommendation {
  return { ...recommendation, action };
}

export function buildModeRecommendations(input: ModeRecommendationInput): ModeRecommendation[] {
  const { mode, capabilitySnapshot, attentionCount = 0 } = input;
  if (!capabilitySnapshot) {
    return [
      rec(
        `mode:${mode.id}:check-services`,
        'Check local services',
        'Today needs the capability registry before it can make machine-aware recommendations.',
        '/settings',
        mode.shortLabel,
        10
      )
    ];
  }

  const topIssue = firstIssue(capabilitySnapshot);
  const localLlm = capability(capabilitySnapshot, 'ai.local-llm');
  const aiService = capability(capabilitySnapshot, 'ai-os.service');
  const aiJobs = capability(capabilitySnapshot, 'ai.jobs');
  const memory = capability(capabilitySnapshot, 'ai.memory');
  const media = capability(capabilitySnapshot, 'ai.media');
  const telemetry = capability(capabilitySnapshot, 'machine.telemetry');
  const offlineCache = capability(capabilitySnapshot, 'browser.offline-cache');
  const paidFallback = capability(capabilitySnapshot, 'ai.paid-fallback');
  const macro = capability(capabilitySnapshot, 'macro.automation');
  const macroService = capability(capabilitySnapshot, 'macro-lab.service');
  const issueCount =
    capabilitySnapshot.summary.offline +
    capabilitySnapshot.summary.blocked +
    capabilitySnapshot.summary.degraded +
    capabilitySnapshot.summary.needsSetup;

  const recommendations: ModeRecommendation[] = [];

  if (mode.id === 'balanced') {
    if (attentionCount > 0) {
      recommendations.push(
        rec(
          'balanced:attention',
          'Work the attention queue',
          `${attentionCount} real signal${attentionCount === 1 ? '' : 's'} from calendar, mail, career, study, or services need review.`,
          '/',
          'Today',
          95
        )
      );
    }
    if (topIssue) {
      recommendations.push(
        rec(
          `balanced:issue:${topIssue.id}`,
          `Resolve ${topIssue.label}`,
          topIssue.lastError ?? topIssue.requiredService ?? topIssue.description,
          topIssue.route,
          topIssue.state.replace('_', ' '),
          85,
          topIssue.id
        )
      );
    }
    if (ready(localLlm) && ready(aiJobs)) {
      recommendations.push(
        rec(
          'balanced:ai-os',
          'Use AI OS for the next task',
          'Local inference and the job queue are available for command-bar work, summaries, and small batches.',
          '/ai-os',
          'Local AI',
          70,
          'ai.local-llm'
        )
      );
    }
  }

  if (mode.id === 'beast') {
    if (ready(aiJobs) && aiJobs?.state === 'running') {
      recommendations.push(
        rec('beast:running-jobs', 'Watch running AI jobs', 'The AI job queue is active; use AI OS to inspect progress and hardware telemetry.', '/ai-os', 'Running', 100, 'ai.jobs')
      );
    }
    if (ready(localLlm)) {
      const telemetryDetail = ready(telemetry)
        ? 'Local LLM and machine telemetry are ready, so this is a good time to benchmark tokens/sec and GPU behavior.'
        : 'Local LLM is ready; open AI OS to benchmark or inspect why telemetry is limited.';
      recommendations.push(
        withAction(
          rec('beast:benchmark', 'Benchmark local compute', telemetryDetail, '/ai-os', 'Benchmark', 95, 'ai.local-llm'),
          { kind: 'run_text_benchmark', label: 'Run' }
        )
      );
    } else if (needsWork(localLlm)) {
      recommendations.push(
        rec(
          'beast:setup-local',
          'Bring a local model online',
          localLlm?.lastError ?? 'Beast Mode is most useful once Ollama or a local OpenAI-compatible server is reachable.',
          '/ai-os',
          'Setup',
          95,
          'ai.local-llm'
        )
      );
    }
    if (ready(media)) {
      recommendations.push(
        rec('beast:media', 'Stress-test media generation', 'A media adapter is available; try local image, audio, or video generation from AI OS.', '/ai-os', 'Media', 80, 'ai.media')
      );
    }
  }

  if (mode.id === 'quiet') {
    if (ready(aiJobs) && aiJobs?.state === 'running') {
      recommendations.push(
        rec('quiet:jobs', 'Review active jobs', 'Quiet Mode clamps new job concurrency, but already-running jobs may still be using local resources.', '/ai-os', 'Queue', 100, 'ai.jobs')
      );
    }
    if (ready(localLlm)) {
      recommendations.push(
        rec('quiet:local-short', 'Use short local AI calls', 'Local inference is available; Quiet Mode keeps routing local and avoids paid fallback unless you explicitly choose it.', '/ai-os', 'Local', 88, 'ai.local-llm')
      );
    }
    if (ready(macro)) {
      recommendations.push(
        rec('quiet:dry-run', 'Dry-run automation only', 'Macro Lab is reachable, so this is a good mode for testing routines without surprise system pressure.', '/macro-lab', 'Dry run', 70, 'macro.automation')
      );
    }
  }

  if (mode.id === 'offline') {
    if (ready(localLlm)) {
      recommendations.push(
        rec('offline:local-ai', 'Use local-only AI', 'A local model route is ready; Offline Mode blocks cloud and paid model routes.', '/ai-os', 'Local only', 95, 'ai.local-llm')
      );
    } else if (needsWork(localLlm)) {
      recommendations.push(
        rec('offline:local-needed', 'Offline AI needs a local model', localLlm?.lastError ?? 'Start Ollama or another local provider before expecting offline AI help.', '/ai-os', 'Setup', 95, 'ai.local-llm')
      );
    }
    if (ready(offlineCache)) {
      recommendations.push(
        rec('offline:cache', 'Review cached hub data', 'The browser cache is available for local-first reads while save controls stay guarded.', '/settings', 'Cache', 80, 'browser.offline-cache')
      );
    }
    if (ready(paidFallback)) {
      recommendations.push(
        rec('offline:paid-skipped', 'Paid fallback is intentionally skipped', 'A paid provider is configured, but Offline Mode keeps AI OS on local/cache-only routes.', '/ai-os', 'Policy', 60, 'ai.paid-fallback')
      );
    }
  }

  if (mode.id === 'night') {
    if (ready(aiJobs) && ready(localLlm)) {
      recommendations.push(
        withAction(
          rec('night:batch', 'Queue a local batch', 'The local model route and job queue are available for overnight map, retry, or summarization work.', '/ai-os', 'Batch', 95, 'ai.jobs'),
          { kind: 'queue_local_summary_batch', label: 'Queue' }
        )
      );
    }
    if (ready(memory)) {
      recommendations.push(
        rec('night:memory', 'Index or search memory', 'Semantic memory is ready, making Night Shift a good time for ingestion, dedupe, and summarization.', '/ai-os', 'Memory', 88, 'ai.memory')
      );
    }
    if (ready(aiService)) {
      recommendations.push(
        withAction(
          rec('night:backup', 'Run backup and restore checks', 'AI OS is reachable, so Foundation Health can verify backups before unattended work.', '/ai-os', 'Backup', 78, 'ai-os.service'),
          {
            kind: 'run_foundation_check',
            label: 'Check',
            confirm: 'Create a fresh AI OS backup, verify it, and run a restore test?'
          }
        )
      );
    }
  }

  if (mode.id === 'maintenance') {
    if (topIssue) {
      recommendations.push(
        rec(
          `maintenance:issue:${topIssue.id}`,
          `Repair ${topIssue.label}`,
          topIssue.lastError ?? topIssue.requiredService ?? topIssue.description,
          topIssue.route,
          topIssue.state.replace('_', ' '),
          100,
          topIssue.id
        )
      );
    }
    if (macroService?.state === 'blocked' && topIssue?.id !== 'macro-lab.service') {
      recommendations.push(
        rec('maintenance:macro-panic', 'Clear Macro Lab panic state', macroService.lastError ?? 'Macro Lab is blocked; inspect panic/armed status before automation work.', '/macro-lab', 'Blocked', 95, 'macro-lab.service')
      );
    }
    if (ready(aiService)) {
      recommendations.push(
        withAction(
          rec('maintenance:foundation', 'Run restore-test and cleanup checks', 'AI OS Foundation Health can verify backups, database integrity, logs, and cleanup paths.', '/ai-os', 'Health', 90, 'ai-os.service'),
          {
            kind: 'run_foundation_check',
            label: 'Check',
            confirm: 'Create a fresh AI OS backup, verify it, and run a restore test?'
          }
        )
      );
    }
    if (!issueCount && ready(telemetry)) {
      recommendations.push(
        rec('maintenance:baseline', 'Capture a clean machine baseline', 'Core services look healthy and telemetry is ready; use AI OS to record current machine status.', '/ai-os', 'Baseline', 70, 'machine.telemetry')
      );
    }
  }

  return recommendations.sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label)).slice(0, 3);
}
