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

export type PassiveSettingsPatch = Partial<Omit<PassiveEngineSettings, 'updatedAt'>>;

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

export async function runPassiveTick(input: { idle?: boolean; limit?: number; reason?: string; eventName?: string } = {}): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ runs: PassiveRun[]; snapshot: PassiveSnapshot }>('/api/passive-tasks/tick', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return result.snapshot;
}

export async function runPassiveEvent(
  eventName: string,
  input: { idle?: boolean; limit?: number; reason?: string } = {}
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

export async function runPassiveTask(taskId: string, input: { idle?: boolean; reason?: string } = {}): Promise<PassiveSnapshot> {
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

export async function dismissPassiveNotification(notificationId: string): Promise<PassiveSnapshot> {
  const result = await requestApiJson<{ ok: true; snapshot: PassiveSnapshot }>(
    `/api/passive-tasks/notifications/${encodeURIComponent(notificationId)}/dismiss`,
    { method: 'POST' }
  );
  return result.snapshot;
}

export function visiblePassiveNotifications(snapshot: PassiveSnapshot | null): PassiveNotification[] {
  return (snapshot?.notifications ?? []).filter((notification) => !notification.dismissedAt).slice(0, 8);
}

export function topPassiveCards(snapshot: PassiveSnapshot | null): PassiveResultCard[] {
  return (snapshot?.digest ?? []).slice(0, 12);
}
