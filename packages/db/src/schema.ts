import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const personalSettings = pgTable('personal_settings', {
  workspaceId: text('workspace_id').primaryKey(),
  theme: text('theme'),
  highScores: jsonb('high_scores').$type<Record<string, unknown>>(),
  recentState: jsonb('recent_state').$type<Record<string, unknown>>(),
  preferences: jsonb('preferences').$type<Record<string, unknown>>(),
  lastLegacyImportAt: timestamp('last_legacy_import_at', { withTimezone: true }),
  deviceId: text('device_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const integrationConnections = pgTable('integration_connections', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  accountLabel: text('account_label').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  encryptedTokenSet: text('encrypted_token_set').notNull(),
  status: text('status').notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const integrationLogs = pgTable('integration_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  requestId: text('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const workspaceMembers = pgTable('workspace_members', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  company: text('company').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('lead'),
  applicationUrl: text('application_url').notNull().default(''),
  fitScore: integer('fit_score'),
  nextActionAt: timestamp('next_action_at', { withTimezone: true }),
  notes: text('notes').notNull().default(''),
  deviceId: text('device_id').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const studySessions = pgTable('study_sessions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  subject: text('subject').notNull(),
  minutes: integer('minutes').notNull(),
  source: text('source').notNull().default('manual'),
  loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
  deviceId: text('device_id').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const careerActions = pgTable('career_actions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  jobId: text('job_id'),
  label: text('label').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deviceId: text('device_id').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const gameRuns = pgTable('game_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  gameId: text('game_id').notNull(),
  score: integer('score').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  deviceId: text('device_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const gameState = pgTable('game_state', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  gameId: text('game_id').notNull(),
  state: jsonb('state').$type<Record<string, unknown>>(),
  deviceId: text('device_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const achievements = pgTable('achievements', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull(),
  deviceId: text('device_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  body: text('body').notNull().default(''),
  deviceId: text('device_id').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const syncEvents = pgTable('sync_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  operation: text('operation').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  deviceId: text('device_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  deviceId: text('device_id').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
