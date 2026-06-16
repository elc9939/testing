import { z } from 'zod';

export const routeMap = {
  today: '/',
  productivity: '/productivity',
  games: '/games',
  stickArenaLab: '/games/stick-arena-lab',
  careerDesk: '/desk/career',
  studyDesk: '/desk/study',
  analytics: '/analytics',
  aiLab: '/ai-lab',
  settings: '/settings'
} as const;

export const legacyStorageKeys = {
  theme: 'miniHub.theme.v1',
  highScores: 'miniHub.highScores.v1',
  recentState: 'miniHub.recent.v1',
  careerJobs: 'careerDesk.jobs.v1',
  careerEmailSeed: 'careerDesk.emailSeed.v6',
  studyState: 'studyDesk.state.v1',
  stickArenaMap: 'stickArena.customMap.v1'
} as const;

export const personalWorkspaceId = 'personal';
export const personalUserId = 'personal-user';

export const launcherEntries = [
  {
    id: 'productivity-hub',
    name: 'Productivity Hub',
    route: routeMap.productivity,
    group: 'command',
    status: 'google-calendar',
    accent: '#2f7dd1'
  },
  {
    id: 'stick-arena-lab',
    name: 'Stick Arena Lab',
    route: routeMap.stickArenaLab,
    group: 'games',
    status: 'vertical-slice',
    accent: '#ff9f6e'
  },
  {
    id: 'career-desk',
    name: 'Career Desk',
    route: routeMap.careerDesk,
    group: 'desk',
    status: 'migration-ready',
    accent: '#4fb477'
  },
  {
    id: 'study-desk',
    name: 'Study Desk',
    route: routeMap.studyDesk,
    group: 'desk',
    status: 'migration-ready',
    accent: '#7aa36f'
  },
  {
    id: 'analytics',
    name: 'Analytics',
    route: routeMap.analytics,
    group: 'insight',
    status: 'duckdb-plot',
    accent: '#5aa9e6'
  },
  {
    id: 'ai-lab',
    name: 'AI Lab',
    route: routeMap.aiLab,
    group: 'intelligence',
    status: 'local-first',
    accent: '#f2c14e'
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
  'asset'
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
export type Workspace = z.infer<typeof workspaceSchema>;
export type JobRecord = z.infer<typeof jobSchema>;
export type StudySession = z.infer<typeof studySessionSchema>;
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
