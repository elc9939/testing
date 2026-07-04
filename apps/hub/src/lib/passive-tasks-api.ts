import type {
  PassiveEngineSettings,
  PassiveNotification,
  PassiveResultCard,
  PassiveRun,
  PassiveSnapshot,
  PassiveTask,
  PassiveTaskFamily,
  PassiveWatcher
} from '@mini-hub/core';
import { requestApiJson } from './api';
import { getBrowserStorage } from './browser-storage';

export type PassiveSettingsPatch = Partial<Omit<PassiveEngineSettings, 'updatedAt'>>;

export const passiveSnapshotCacheKey = 'miniHub.passiveTasks.snapshot.v1';

interface PassiveSnapshotCache {
  version: 1;
  cachedAt: string;
  snapshot: PassiveSnapshot;
}

function validPassiveSnapshot(value: Partial<PassiveSnapshot> | null | undefined): value is PassiveSnapshot {
  return Boolean(
    value &&
      typeof value.checkedAt === 'string' &&
      Array.isArray(value.watchers) &&
      Array.isArray(value.triggers) &&
      Array.isArray(value.tasks) &&
      Array.isArray(value.runs) &&
      Array.isArray(value.results) &&
      Array.isArray(value.notifications) &&
      Array.isArray(value.digest) &&
      Array.isArray(value.sources) &&
      Array.isArray(value.errors)
  );
}

export function readCachedPassiveSnapshot(): { cachedAt: string; snapshot: PassiveSnapshot } | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(passiveSnapshotCacheKey) ?? 'null') as Partial<PassiveSnapshotCache> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.cachedAt !== 'string') return null;
    if (!validPassiveSnapshot(parsed.snapshot)) return null;
    return { cachedAt: parsed.cachedAt, snapshot: parsed.snapshot };
  } catch {
    return null;
  }
}

export function writePassiveSnapshotCache(snapshot: PassiveSnapshot): { cachedAt?: string; error?: string } {
  const storage = getBrowserStorage();
  if (!storage) {
    return { error: 'Browser Passive Tasks cache is unavailable; live run history is visible but may not survive refresh.' };
  }
  const cachedAt = new Date().toISOString();
  try {
    storage.setItem(passiveSnapshotCacheKey, JSON.stringify({ version: 1, cachedAt, snapshot } satisfies PassiveSnapshotCache));
    return { cachedAt };
  } catch {
    return { error: 'Browser Passive Tasks cache could not be updated; live run history is visible but may not survive refresh.' };
  }
}

export function passiveFamilyLabel(family: PassiveTaskFamily): string {
  if (family === 'app_health') return 'App Health';
  if (family === 'backup_snapshot') return 'Backups';
  if (family === 'idle_compute') return 'Idle Compute';
  if (family === 'research_monitor') return 'Research';
  if (family === 'career_radar') return 'Career';
  if (family === 'file_intelligence') return 'Files';
  return 'Project Drift';
}

export function passiveRunStatusLabel(status: PassiveRun['status']): string {
  if (status === 'succeeded') return 'ok';
  return status.replace('_', ' ');
}

export function passiveUrgencyLabel(urgency: number): string {
  if (urgency >= 85) return 'urgent';
  if (urgency >= 70) return 'high';
  if (urgency >= 55) return 'watch';
  return 'low';
}

export function passiveTaskActive(task: PassiveTask, watcher: PassiveWatcher | undefined, settings: PassiveEngineSettings): boolean {
  return Boolean(settings.enabled && watcher?.enabled && settings.enabledFamilies[task.family] !== false && task.status !== 'cancelled');
}

export async function getPassiveSnapshot(): Promise<PassiveSnapshot> {
  return requestApiJson<PassiveSnapshot>('/api/passive-tasks/snapshot');
}

export async function patchPassiveSettings(patch: PassiveSettingsPatch): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ settings: PassiveEngineSettings; snapshot: PassiveSnapshot }>(
    '/api/passive-tasks/settings',
    {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }
  );
  return result.snapshot;
}

interface PassiveRunRequestInput {
  idle?: boolean;
  idleMinutes?: number;
  idleSource?: string;
  idleError?: string;
  limit?: number;
  reason?: string;
  eventName?: string;
}

export async function runPassiveTick(input: PassiveRunRequestInput = {}): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ runs: PassiveRun[]; snapshot: PassiveSnapshot }>('/api/passive-tasks/tick', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.snapshot;
}

export async function runPassiveEvent(
  eventName: string,
  input: Omit<PassiveRunRequestInput, 'eventName'> = {}
): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ runs: PassiveRun[]; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/events/${encodeURIComponent(eventName)}`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  return result.snapshot;
}

export async function runPassiveTask(taskId: string, input: { idle?: boolean; reason?: string; manual?: boolean } = {}): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ run: PassiveRun; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/tasks/${encodeURIComponent(taskId)}/run`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  return result.snapshot;
}

export async function pausePassiveTask(taskId: string): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ task: PassiveTask; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/tasks/${encodeURIComponent(taskId)}/pause`,
    { method: 'POST' }
  );
  return result.snapshot;
}

export async function resumePassiveTask(taskId: string): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ task: PassiveTask; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/tasks/${encodeURIComponent(taskId)}/resume`,
    { method: 'POST' }
  );
  return result.snapshot;
}

export async function cancelPassiveTask(taskId: string): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ task: PassiveTask; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST' }
  );
  return result.snapshot;
}

export async function togglePassiveWatcher(watcherId: string, enabled: boolean): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ watcher: PassiveWatcher; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/watchers/${encodeURIComponent(watcherId)}/toggle`,
    {
      method: 'POST',
      body: JSON.stringify({ enabled })
    }
  );
  return result.snapshot;
}

export async function triagePassiveCard(
  cardId: string,
  input: { status: 'reviewed' | 'dismissed' | 'snoozed' | 'important' | 'clear'; snoozedUntil?: string; reason?: string }
): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ settings: PassiveEngineSettings; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/cards/${encodeURIComponent(cardId)}/triage`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  return result.snapshot;
}

export async function dismissPassiveNotification(notificationId: string): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ ok: true; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/notifications/${encodeURIComponent(notificationId)}/dismiss`,
    { method: 'POST' }
  );
  return result.snapshot;
}

function timeValue(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function compactIssueText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

function passiveNotificationLooksLikeServiceIssue(notification: PassiveNotification): boolean {
  const text = compactIssueText([notification.title, notification.body, notification.family].join(' '));
  return /\b(unavailable|offline|failed|error|fetch|refused|timeout|timed|aborted|missing|not found|setup|restore|verify|blocked)\b/u.test(text);
}

function passiveNotificationResolvedByCurrentSource(notification: PassiveNotification, snapshot: PassiveSnapshot): boolean {
  if (!passiveNotificationLooksLikeServiceIssue(notification)) return false;
  const notificationAt = timeValue(notification.createdAt);
  if (!Number.isFinite(notificationAt)) return false;
  return snapshot.sources.some((source) => {
    if (source.id !== notification.family || source.status !== 'ok') return false;
    const fetchedAt = timeValue(source.fetchedAt);
    return Number.isFinite(fetchedAt) && fetchedAt > notificationAt;
  });
}

export function visiblePassiveNotifications(snapshot: PassiveSnapshot | null): PassiveNotification[] {
  if (!snapshot) return [];
  return snapshot.notifications
    .filter((notification) => !notification.dismissedAt)
    .filter((notification) => !passiveNotificationResolvedByCurrentSource(notification, snapshot))
    .slice(0, 8);
}

export function topPassiveCards(snapshot: PassiveSnapshot | null): PassiveResultCard[] {
  return (snapshot?.digest ?? []).slice(0, 12);
}
