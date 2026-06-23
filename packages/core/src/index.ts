import { z } from 'zod';

export const routeMap = {
  today: '/',
  activity: '/activity',
  productivity: '/productivity',
  games: '/games',
  stickArenaLab: '/games/stick-arena-lab',
  careerDesk: '/desk/career',
  studyDesk: '/desk/study',
  analytics: '/analytics',
  research: '/research',
  aiLab: '/ai-lab',
  aiOs: '/ai-os',
  macroLab: '/macro-lab',
  passiveTasks: '/passive-tasks',
  settings: '/settings'
} as const;

export const legacyStorageKeys = {
  theme: 'miniHub.theme.v1',
  highScores: 'miniHub.highScores.v1',
  recentState: 'miniHub.recents.v1',
  careerJobs: 'careerDesk.jobs.v1',
  careerEmailSeed: 'careerDesk.emailSeed.v6',
  studyState: 'studyDesk.state.v1',
  stickArenaMap: 'stickArenaMap'
} as const;

export const personalWorkspaceId = 'personal';
export const personalUserId = 'personal-user';

export const launcherEntries = [
  {
    id: 'activity',
    name: 'Activity',
    route: routeMap.activity,
    group: 'command',
    status: 'recovery-surface'
  },
  {
    id: 'productivity-hub',
    name: 'Productivity Hub',
    route: routeMap.productivity,
    group: 'command',
    status: 'google-calendar'
  },
  {
    id: 'stick-arena-lab',
    name: 'Stick Arena Lab',
    route: routeMap.stickArenaLab,
    group: 'games',
    status: 'vertical-slice'
  },
  {
    id: 'career-desk',
    name: 'Career Desk',
    route: routeMap.careerDesk,
    group: 'desk',
    status: 'migration-ready'
  },
  {
    id: 'study-desk',
    name: 'Study Desk',
    route: routeMap.studyDesk,
    group: 'desk',
    status: 'migration-ready'
  },
  {
    id: 'analytics',
    name: 'Analytics',
    route: routeMap.analytics,
    group: 'insight',
    status: 'duckdb-plot'
  },
  {
    id: 'research-desk',
    name: 'Research Desk',
    route: routeMap.research,
    group: 'insight',
    status: 'web-intelligence'
  },
  {
    id: 'ai-lab',
    name: 'AI Lab',
    route: routeMap.aiLab,
    group: 'intelligence',
    status: 'local-first'
  },
  {
    id: 'ai-os',
    name: 'Personal AI OS',
    route: routeMap.aiOs,
    group: 'intelligence',
    status: 'capability-substrate'
  },
  {
    id: 'macro-lab',
    name: 'Macro Lab',
    route: routeMap.macroLab,
    group: 'automation',
    status: 'local-control'
  },
  {
    id: 'passive-tasks',
    name: 'Passive Tasks',
    route: routeMap.passiveTasks,
    group: 'automation',
    status: 'background-engine'
  }
] as const;

export const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);

export const entityTypeSchema = z.enum([
  'workspace',
  'settings',
  'integration_connection',
  'timeline_item',
  'job',
  'study_session',
  'career_action',
  'game_run',
  'game_state',
  'achievement',
  'note',
  'asset',
  'passive_watcher',
  'passive_task',
  'passive_run',
  'passive_notification'
]);

export const connectorKindSchema = z.enum(['google', 'brightspace', 'manual']);

export const connectorCapabilitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  access: z.enum(['read', 'write', 'action']),
  status: z.enum(['implemented', 'planned', 'read-only', 'blocked']),
  reason: z.string().optional()
});

export const integrationConnectionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  provider: connectorKindSchema,
  accountLabel: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  encryptedTokenSet: z.string().default(''),
  status: z.enum(['connected', 'needs_reauth', 'revoked', 'error']),
  lastSyncAt: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const calendarEventSchema = z.object({
  id: z.string().min(1),
  calendarId: z.string().min(1),
  provider: connectorKindSchema,
  title: z.string().min(1),
  description: z.string().default(''),
  location: z.string().default(''),
  start: z.string().min(1),
  end: z.string().min(1),
  timeZone: z.string().default('UTC'),
  status: z.string().default('confirmed'),
  htmlLink: z.string().optional(),
  recurringEventId: z.string().optional(),
  recurrence: z.array(z.string()).default([]),
  reminders: z
    .object({
      useDefault: z.boolean().default(true),
      overrides: z.array(z.object({ method: z.string().min(1), minutes: z.number().int().nonnegative() })).default([])
    })
    .default({ useDefault: true, overrides: [] }),
  raw: z.record(z.string(), z.unknown()).default({})
});

export const gmailLabelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().default('user'),
  messageListVisibility: z.string().optional(),
  labelListVisibility: z.string().optional()
});

export const gmailMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(''),
  subject: z.string().default('(no subject)'),
  from: z.string().default(''),
  to: z.string().default(''),
  cc: z.string().default(''),
  date: z.string().default(''),
  internalDate: z.string().default(''),
  messageIdHeader: z.string().default(''),
  references: z.string().default(''),
  inReplyTo: z.string().default(''),
  bodyText: z.string().default(''),
  bodyHtml: z.string().default(''),
  headers: z.record(z.string(), z.string()).default({})
});

export const gmailThreadSchema = z.object({
  id: z.string().min(1),
  historyId: z.string().default(''),
  snippet: z.string().default(''),
  labelIds: z.array(z.string()).default([]),
  subject: z.string().default('(no subject)'),
  from: z.string().default(''),
  date: z.string().default(''),
  unread: z.boolean().default(false),
  messages: z.array(gmailMessageSchema).default([])
});

export const gmailDraftSchema = z.object({
  id: z.string().min(1),
  message: gmailMessageSchema.optional()
});

export const timelineItemSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['google_calendar', 'brightspace', 'gmail', 'manual']),
  sourceId: z.string().min(1),
  kind: z.enum(['event', 'deadline', 'email_action', 'task']),
  title: z.string().min(1),
  when: z.string().min(1),
  end: z.string().optional(),
  timeZone: z.string().default('UTC'),
  actionUrl: z.string().optional(),
  canEdit: z.boolean().default(false),
  canComplete: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const syncEventSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityType: entityTypeSchema,
  entityId: z.string().min(1),
  operation: z.enum(['insert', 'update', 'delete']),
  payload: z.record(z.string(), z.unknown()).default({}),
  deviceId: z.string().min(1),
  createdAt: z.string().min(1)
});

export const actionLedgerStatusSchema = z.enum([
  'succeeded',
  'failed',
  'running',
  'queued',
  'paused',
  'cancelled',
  'dry_run',
  'blocked',
  'info'
]);

export const actionLedgerRiskSchema = z.enum(['read', 'write', 'system', 'destructive']);

export const actionLedgerSystemSchema = z.enum(['mini-hub', 'ai-os', 'macro-lab', 'browser']);

export const actionRecoverabilitySchema = z.object({
  kind: z.enum(['none', 'backup', 'snapshot', 'dry_run', 'patch', 'restore_test', 'artifact']).default('none'),
  referenceId: z.string().optional(),
  route: z.string().optional(),
  description: z.string().default(''),
  reversible: z.boolean().default(false)
});

export const attentionSourceSchema = z.enum([
  'google_calendar',
  'gmail',
  'career_job',
  'career_action',
  'study_session',
  'study_signal',
  'ai_os',
  'macro_lab',
  'research',
  'passive_task',
  'service_health',
  'manual'
]);

export const attentionStatusSchema = z.enum(['active', 'done', 'dismissed', 'snoozed', 'archived', 'blocked']);

export const attentionActionKindSchema = z.enum([
  'open',
  'mark_read',
  'mark_important',
  'archive',
  'complete',
  'snooze',
  'dismiss',
  'run',
  'restore',
  'inspect'
]);

export const attentionActionSchema = z.object({
  kind: attentionActionKindSchema,
  label: z.string().min(1),
  available: z.boolean().default(true),
  reason: z.string().optional(),
  route: z.string().optional(),
  requiresOnline: z.boolean().default(false),
  risk: actionLedgerRiskSchema.default('read')
});

export const attentionItemSchema = z.object({
  id: z.string().min(1),
  source: attentionSourceSchema,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().default(''),
  route: z.string().min(1),
  dueAt: z.string().optional(),
  priority: z.number().min(0).max(100).default(50),
  status: attentionStatusSchema.default('active'),
  actionKind: attentionActionKindSchema.optional(),
  actions: z.array(attentionActionSchema).default([]),
  recoverability: actionRecoverabilitySchema.default({ kind: 'none', description: '', reversible: false }),
  readOnly: z.boolean().default(false),
  writable: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const attentionTriageStateSchema = z.object({
  itemId: z.string().min(1),
  status: attentionStatusSchema.optional(),
  snoozedUntil: z.string().optional(),
  manuallyImportant: z.boolean().optional(),
  completedAt: z.string().optional(),
  dismissedAt: z.string().optional(),
  archivedAt: z.string().optional(),
  updatedAt: z.string().min(1)
});

export const attentionSourceStatusSchema = z.object({
  id: attentionSourceSchema,
  label: z.string().min(1),
  status: z.enum(['ok', 'unavailable', 'error']),
  fetchedAt: z.string().optional(),
  itemCount: z.number().int().nonnegative().default(0),
  error: z.string().optional()
});

export const attentionSnapshotSchema = z.object({
  checkedAt: z.string().min(1),
  items: z.array(attentionItemSchema),
  sources: z.array(attentionSourceStatusSchema),
  triageState: z.record(z.string(), attentionTriageStateSchema).default({}),
  errors: z.array(z.string()).default([])
});

export const actionLedgerEntrySchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().min(1),
  system: actionLedgerSystemSchema,
  source: z.string().min(1),
  actionType: z.string().min(1),
  summary: z.string().min(1),
  status: actionLedgerStatusSchema,
  risk: actionLedgerRiskSchema,
  mode: z.string().optional(),
  changed: z.array(z.string()).default([]),
  recoverability: actionRecoverabilitySchema.default({ kind: 'none', description: '', reversible: false }),
  rawRef: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const passiveTaskFamilySchema = z.enum([
  'app_health',
  'backup_snapshot',
  'idle_compute',
  'research_monitor',
  'career_radar',
  'file_intelligence',
  'project_drift'
]);

export const passiveTriggerKindSchema = z.enum(['schedule', 'event', 'idle', 'manual']);

export const passiveTaskStatusSchema = z.enum([
  'active',
  'paused',
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'cancelled'
]);

export const passiveRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'blocked']);

export const passiveNotificationLevelSchema = z.enum(['info', 'success', 'warning', 'error', 'urgent']);

export const passiveCardTriageStatusSchema = z.enum(['reviewed', 'dismissed', 'snoozed', 'important']);

export const passiveSourceRefSchema = z.object({
  kind: z.enum(['route', 'url', 'file', 'record', 'service']).default('record'),
  id: z.string().min(1),
  label: z.string().min(1),
  route: z.string().optional(),
  url: z.string().optional(),
  filePath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const passiveTriggerSchema = z.object({
  id: z.string().min(1),
  kind: passiveTriggerKindSchema,
  label: z.string().min(1),
  watcherId: z.string().optional(),
  taskIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().positive().optional(),
  eventName: z.string().optional(),
  idleMinutes: z.number().int().positive().optional(),
  lastFiredAt: z.string().optional(),
  lastRunId: z.string().optional(),
  lastStatus: passiveRunStatusSchema.optional(),
  nextRunAt: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const passiveWatcherSchema = z.object({
  id: z.string().min(1),
  family: passiveTaskFamilySchema,
  title: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  triggerIds: z.array(z.string()).default([]),
  taskIds: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  pausedAt: z.string().optional(),
  error: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).default({})
});

export const passiveRetryStateSchema = z.object({
  maxAttempts: z.number().int().positive().default(3),
  attempts: z.number().int().nonnegative().default(0),
  backoffMinutes: z.number().int().positive().default(15),
  nextRetryAt: z.string().optional()
});

export const passiveTaskErrorLogEntrySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  status: passiveRunStatusSchema,
  message: z.string().min(1),
  at: z.string().min(1),
  attempt: z.number().int().nonnegative().default(1),
  nextRetryAt: z.string().optional()
});

export const passiveTaskSchema = z.object({
  id: z.string().min(1),
  watcherId: z.string().min(1),
  family: passiveTaskFamilySchema,
  title: z.string().min(1),
  detail: z.string().default(''),
  trigger: passiveTriggerSchema,
  priority: z.number().min(0).max(100).default(50),
  machineMode: z.string().optional(),
  idleOnly: z.boolean().default(false),
  status: passiveTaskStatusSchema.default('active'),
  retry: passiveRetryStateSchema.default({ maxAttempts: 3, attempts: 0, backoffMinutes: 15 }),
  route: z.string().min(1).default('/passive-tasks'),
  sourceRefs: z.array(passiveSourceRefSchema).default([]),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  lastError: z.string().optional(),
  errorLog: z.array(passiveTaskErrorLogEntrySchema).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).default({})
});

export const passiveResultCardSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  family: passiveTaskFamilySchema,
  title: z.string().min(1),
  summary: z.string().default(''),
  urgency: z.number().min(0).max(100).default(40),
  confidence: z.number().min(0).max(1).default(0.7),
  route: z.string().min(1).default('/passive-tasks'),
  sourceRefs: z.array(passiveSourceRefSchema).default([]),
  suggestedAction: z.string().default('Inspect'),
  actionKind: attentionActionKindSchema.optional(),
  why: z.string().default('Passive task output matched configured watch criteria.'),
  createdAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const passiveResultSchema = passiveResultCardSchema;

export const passiveRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  watcherId: z.string().min(1),
  family: passiveTaskFamilySchema,
  status: passiveRunStatusSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  attempt: z.number().int().nonnegative().default(1),
  error: z.string().optional(),
  cards: z.array(passiveResultCardSchema).default([]),
  changed: z.array(z.string()).default([]),
  nextRunAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const passiveNotificationSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  family: passiveTaskFamilySchema,
  title: z.string().min(1),
  body: z.string().default(''),
  level: passiveNotificationLevelSchema.default('info'),
  route: z.string().min(1).default('/passive-tasks'),
  cardIds: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  readAt: z.string().optional(),
  dismissedAt: z.string().optional()
});

export const passiveIdleStateSchema = z.object({
  idle: z.boolean(),
  thresholdMinutes: z.number().int().positive(),
  checkedAt: z.string().min(1),
  source: z.string().min(1),
  idleMinutes: z.number().nonnegative().optional(),
  error: z.string().optional()
});

export const passiveWorkerStateSchema = z.object({
  id: z.string().min(1).default('passive-worker'),
  enabled: z.boolean().default(true),
  running: z.boolean().default(false),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  lastTickAt: z.string().optional(),
  lastTickFinishedAt: z.string().optional(),
  nextTickAt: z.string().optional(),
  intervalMs: z.number().int().nonnegative().default(0),
  lastEventName: z.string().optional(),
  lastIdle: passiveIdleStateSchema.optional(),
  activeFileWatchCount: z.number().int().nonnegative().default(0),
  pendingFileEvent: z.boolean().default(false),
  lastError: z.string().optional(),
  updatedAt: z.string().min(1)
});

export const passiveCardTriageStateSchema = z.object({
  cardId: z.string().min(1),
  status: passiveCardTriageStatusSchema,
  updatedAt: z.string().min(1),
  snoozedUntil: z.string().optional(),
  reason: z.string().optional()
});

export const passiveEngineSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  notificationStyle: z.enum(['digest', 'urgent_only', 'off']).default('digest'),
  idleOnly: z.boolean().default(false),
  resourceLimit: z.enum(['light', 'balanced', 'heavy']).default('balanced'),
  localAiPreference: z.enum(['local_first', 'local_only', 'cloud_allowed']).default('local_first'),
  maxRunsPerTick: z.number().int().positive().max(10).default(3),
  watchedFolders: z.array(z.string()).default([]),
  watchedDomains: z.array(z.string()).default([]),
  watchedAccounts: z.array(z.string()).default([]),
  enabledFamilies: z.record(z.string(), z.boolean()).default({}),
  cardTriage: z.record(z.string(), passiveCardTriageStateSchema).default({}),
  updatedAt: z.string().min(1)
});

export const passiveSourceStatusSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['ok', 'unavailable', 'error']),
  fetchedAt: z.string().optional(),
  error: z.string().optional(),
  details: z.record(z.string(), z.unknown()).default({})
});

export const passiveBackupHealthSchema = z.object({
  checkedAt: z.string().min(1),
  ok: z.boolean(),
  status: z.enum(['ok', 'warning', 'error']),
  snapshotRoot: z.string().min(1),
  snapshotCount: z.number().int().nonnegative(),
  latestPath: z.string().optional(),
  latestAgeHours: z.number().nonnegative().optional(),
  stale: z.boolean().default(false),
  latestBytes: z.number().int().nonnegative().optional(),
  latestSha256: z.string().optional(),
  latestSummary: z.record(z.string(), z.number()).default({}),
  latestRedactedTokenSets: z.number().int().nonnegative().default(0),
  cleanupCandidateCount: z.number().int().nonnegative().default(0),
  cleanupBytes: z.number().int().nonnegative().default(0),
  error: z.string().optional()
});

export const passiveSnapshotSchema = z.object({
  checkedAt: z.string().min(1),
  settings: passiveEngineSettingsSchema,
  watchers: z.array(passiveWatcherSchema),
  triggers: z.array(passiveTriggerSchema),
  tasks: z.array(passiveTaskSchema),
  worker: passiveWorkerStateSchema,
  runs: z.array(passiveRunSchema),
  results: z.array(passiveResultSchema),
  notifications: z.array(passiveNotificationSchema),
  digest: z.array(passiveResultCardSchema),
  sources: z.array(passiveSourceStatusSchema),
  backupHealth: passiveBackupHealthSchema,
  errors: z.array(z.string()).default([])
});

export const passiveEnginePersistedStateSchema = z.object({
  version: z.literal(1),
  settings: passiveEngineSettingsSchema.nullable().default(null),
  worker: passiveWorkerStateSchema.nullable().default(null),
  watchers: z.array(passiveWatcherSchema).default([]),
  triggers: z.array(passiveTriggerSchema).default([]),
  tasks: z.array(passiveTaskSchema).default([]),
  runs: z.array(passiveRunSchema).default([]),
  results: z.array(passiveResultSchema).default([]),
  notifications: z.array(passiveNotificationSchema).default([])
});

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const jobSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  status: z.string().min(1).default('lead'),
  applicationUrl: z.string().default(''),
  fitScore: z.number().min(0).max(100).optional(),
  nextActionAt: z.string().optional(),
  notes: z.string().default(''),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const studySessionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  subject: z.string().min(1),
  minutes: z.number().int().nonnegative(),
  source: z.string().default('manual'),
  loggedAt: z.string().min(1),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const careerActionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  jobId: z.string().optional(),
  label: z.string().min(1),
  dueAt: z.string().optional(),
  completedAt: z.string().optional(),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const gameRunSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  gameId: z.string().min(1),
  score: z.number().finite().default(0),
  durationMs: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const personalSettingsSchema = z.object({
  workspaceId: z.string().min(1),
  theme: z.string().optional(),
  highScores: z.record(z.string(), z.unknown()).default({}),
  recentState: z.record(z.string(), z.unknown()).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
  lastLegacyImportAt: z.string().optional(),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const gameStateSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  gameId: z.string().min(1),
  state: z.record(z.string(), z.unknown()).default({}),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const achievementSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  code: z.string().min(1),
  title: z.string().min(1),
  unlockedAt: z.string().min(1),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const noteSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityType: entityTypeSchema,
  entityId: z.string().min(1),
  body: z.string().default(''),
  deviceId: z.string().min(1),
  updatedAt: z.string().min(1)
});

export type Role = z.infer<typeof roleSchema>;
export type EntityType = z.infer<typeof entityTypeSchema>;
export type ConnectorKind = z.infer<typeof connectorKindSchema>;
export type ConnectorCapability = z.infer<typeof connectorCapabilitySchema>;
export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type GmailLabel = z.infer<typeof gmailLabelSchema>;
export type GmailMessage = z.infer<typeof gmailMessageSchema>;
export type GmailThread = z.infer<typeof gmailThreadSchema>;
export type GmailDraft = z.infer<typeof gmailDraftSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type ActionLedgerStatus = z.infer<typeof actionLedgerStatusSchema>;
export type ActionLedgerRisk = z.infer<typeof actionLedgerRiskSchema>;
export type ActionLedgerSystem = z.infer<typeof actionLedgerSystemSchema>;
export type ActionRecoverability = z.infer<typeof actionRecoverabilitySchema>;
export type AttentionSource = z.infer<typeof attentionSourceSchema>;
export type AttentionStatus = z.infer<typeof attentionStatusSchema>;
export type AttentionActionKind = z.infer<typeof attentionActionKindSchema>;
export type AttentionAction = z.infer<typeof attentionActionSchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type AttentionTriageState = z.infer<typeof attentionTriageStateSchema>;
export type AttentionSourceStatus = z.infer<typeof attentionSourceStatusSchema>;
export type AttentionSnapshot = z.infer<typeof attentionSnapshotSchema>;
export type ActionLedgerEntry = z.infer<typeof actionLedgerEntrySchema>;
export type PassiveTaskFamily = z.infer<typeof passiveTaskFamilySchema>;
export type PassiveTriggerKind = z.infer<typeof passiveTriggerKindSchema>;
export type PassiveTaskStatus = z.infer<typeof passiveTaskStatusSchema>;
export type PassiveRunStatus = z.infer<typeof passiveRunStatusSchema>;
export type PassiveNotificationLevel = z.infer<typeof passiveNotificationLevelSchema>;
export type PassiveCardTriageStatus = z.infer<typeof passiveCardTriageStatusSchema>;
export type PassiveSourceRef = z.infer<typeof passiveSourceRefSchema>;
export type PassiveTrigger = z.infer<typeof passiveTriggerSchema>;
export type PassiveWatcher = z.infer<typeof passiveWatcherSchema>;
export type PassiveRetryState = z.infer<typeof passiveRetryStateSchema>;
export type PassiveTask = z.infer<typeof passiveTaskSchema>;
export type PassiveResultCard = z.infer<typeof passiveResultCardSchema>;
export type PassiveResult = z.infer<typeof passiveResultSchema>;
export type PassiveRun = z.infer<typeof passiveRunSchema>;
export type PassiveNotification = z.infer<typeof passiveNotificationSchema>;
export type PassiveIdleStateRecord = z.infer<typeof passiveIdleStateSchema>;
export type PassiveWorkerState = z.infer<typeof passiveWorkerStateSchema>;
export type PassiveCardTriageState = z.infer<typeof passiveCardTriageStateSchema>;
export type PassiveEngineSettings = z.infer<typeof passiveEngineSettingsSchema>;
export type PassiveTaskErrorLogEntry = z.infer<typeof passiveTaskErrorLogEntrySchema>;
export type PassiveSourceStatus = z.infer<typeof passiveSourceStatusSchema>;
export type PassiveBackupHealth = z.infer<typeof passiveBackupHealthSchema>;
export type PassiveSnapshot = z.infer<typeof passiveSnapshotSchema>;
export type PassiveEnginePersistedState = z.infer<typeof passiveEnginePersistedStateSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type JobRecord = z.infer<typeof jobSchema>;
export type StudySession = z.infer<typeof studySessionSchema>;
export type CareerActionRecord = z.infer<typeof careerActionSchema>;
export type GameRun = z.infer<typeof gameRunSchema>;
export type PersonalSettings = z.infer<typeof personalSettingsSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type Achievement = z.infer<typeof achievementSchema>;
export type NoteRecord = z.infer<typeof noteSchema>;
export type LauncherEntry = (typeof launcherEntries)[number];

export function createDeviceId(prefix = 'web'): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && 'randomUUID' in cryptoApi) {
    return `${prefix}:${cryptoApi.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
