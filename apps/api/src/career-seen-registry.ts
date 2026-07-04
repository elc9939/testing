import { personalSettingsSchema, personalWorkspaceId, type JobRecord, type PersonalSettings } from '@mini-hub/core';
import { appendSyncEvent, type MemoryStore, withBeforeSnapshot } from './store';

const defaultRegistryLimit = 500;

export interface CareerSeenLeadRegistryEntry {
  fingerprint: string;
  company: string;
  role: string;
  applicationUrl?: string;
  urlKey?: string;
  companyKey: string;
  companyRoleKey: string;
  status: string;
  source: string;
  jobId?: string;
  fitScore?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

export interface CareerSeenLeadKeys {
  fingerprints: Set<string>;
  urls: Set<string>;
  companyRoles: Set<string>;
  companies: Set<string>;
}

interface UpsertOptions {
  date?: Date;
  deviceId?: string;
  reason?: string;
  source?: string;
  status?: string;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function normalizeCareerLeadText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

export function careerLeadCompanyKey(value: string): string {
  return normalizeCareerLeadText(value)
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|careers|jobs)\b/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function careerLeadUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export function careerLeadCompanyRoleKey(company: string, role: string): string {
  return `${careerLeadCompanyKey(company)}|${normalizeCareerLeadText(role)}`;
}

export function careerLeadFingerprint(input: Pick<JobRecord, 'company' | 'role' | 'applicationUrl'>): string {
  const urlKey = input.applicationUrl ? careerLeadUrlKey(input.applicationUrl) : '';
  if (urlKey) return `url:${urlKey}`;
  return `company-role:${careerLeadCompanyRoleKey(input.company, input.role)}`;
}

function defaultSettings(date = new Date()): PersonalSettings {
  return personalSettingsSchema.parse({
    workspaceId: personalWorkspaceId,
    highScores: {},
    recentState: {},
    preferences: {},
    deviceId: 'api',
    updatedAt: nowIso(date)
  });
}

function registryEntriesFromPreferences(preferences: Record<string, unknown>): CareerSeenLeadRegistryEntry[] {
  const raw = preferences.careerSeenLeadRegistry;
  const entries = isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  return entries
    .filter(isRecord)
    .map((entry): CareerSeenLeadRegistryEntry | null => {
      const company = textValue(entry.company);
      const role = textValue(entry.role);
      const companyKey = textValue(entry.companyKey) || careerLeadCompanyKey(company);
      const companyRoleKey = textValue(entry.companyRoleKey) || careerLeadCompanyRoleKey(company, role);
      const applicationUrl = textValue(entry.applicationUrl);
      const urlKey = textValue(entry.urlKey) || (applicationUrl ? careerLeadUrlKey(applicationUrl) : '');
      const fingerprint = textValue(entry.fingerprint) || (urlKey ? `url:${urlKey}` : `company-role:${companyRoleKey}`);
      const fitScore = numberValue(entry.fitScore);
      if (!fingerprint || !company || !role || !companyKey || !companyRoleKey) return null;
      return {
        fingerprint,
        company,
        role,
        ...(applicationUrl ? { applicationUrl } : {}),
        ...(urlKey ? { urlKey } : {}),
        companyKey,
        companyRoleKey,
        status: textValue(entry.status) || 'lead',
        source: textValue(entry.source) || 'career-desk',
        ...(textValue(entry.jobId) ? { jobId: textValue(entry.jobId) } : {}),
        ...(fitScore !== undefined ? { fitScore } : {}),
        firstSeenAt: textValue(entry.firstSeenAt) || textValue(entry.lastSeenAt) || new Date(0).toISOString(),
        lastSeenAt: textValue(entry.lastSeenAt) || textValue(entry.firstSeenAt) || new Date(0).toISOString(),
        seenCount: Math.max(1, Math.trunc(numberValue(entry.seenCount) ?? 1))
      };
    })
    .filter((entry): entry is CareerSeenLeadRegistryEntry => Boolean(entry));
}

export function careerSeenLeadRegistry(store: Pick<MemoryStore, 'settings'>): CareerSeenLeadRegistryEntry[] {
  return registryEntriesFromPreferences(store.settings?.preferences ?? {});
}

export function careerSeenLeadKeys(store: Pick<MemoryStore, 'settings'>): CareerSeenLeadKeys {
  const keys: CareerSeenLeadKeys = {
    fingerprints: new Set(),
    urls: new Set(),
    companyRoles: new Set(),
    companies: new Set()
  };
  for (const entry of careerSeenLeadRegistry(store)) {
    keys.fingerprints.add(entry.fingerprint);
    if (entry.urlKey) keys.urls.add(entry.urlKey);
    if (entry.companyRoleKey) keys.companyRoles.add(entry.companyRoleKey);
    if (entry.companyKey) keys.companies.add(entry.companyKey);
  }
  return keys;
}

function careerJobSource(job: JobRecord): string {
  if (job.notes.includes('Discovered by Career Discovery')) return 'career-discovery';
  if (job.id.startsWith('legacy-career-job') || job.notes.includes('Legacy Career Desk details')) return 'legacy-import';
  if (job.deviceId === 'passive-engine') return 'passive-engine';
  return 'career-desk';
}

function entryMatchesJob(entry: CareerSeenLeadRegistryEntry, job: JobRecord): boolean {
  const urlKey = job.applicationUrl ? careerLeadUrlKey(job.applicationUrl) : '';
  const companyRoleKey = careerLeadCompanyRoleKey(job.company, job.role);
  return Boolean(
    (urlKey && entry.urlKey === urlKey) ||
      entry.companyRoleKey === companyRoleKey ||
      (entry.jobId && entry.jobId === job.id) ||
      entry.fingerprint === careerLeadFingerprint(job)
  );
}

function entryForJob(job: JobRecord, existing: CareerSeenLeadRegistryEntry | undefined, options: Required<Pick<UpsertOptions, 'date'>> & UpsertOptions): CareerSeenLeadRegistryEntry {
  const lastSeenAt = nowIso(options.date);
  const applicationUrl = job.applicationUrl.trim();
  const urlKey = applicationUrl ? careerLeadUrlKey(applicationUrl) : '';
  const companyKey = careerLeadCompanyKey(job.company);
  const companyRoleKey = careerLeadCompanyRoleKey(job.company, job.role);
  return {
    fingerprint: urlKey ? `url:${urlKey}` : `company-role:${companyRoleKey}`,
    company: job.company.trim(),
    role: job.role.trim(),
    ...(applicationUrl ? { applicationUrl } : {}),
    ...(urlKey ? { urlKey } : {}),
    companyKey,
    companyRoleKey,
    status: options.status ?? job.status,
    source: options.source ?? careerJobSource(job),
    jobId: job.id,
    ...(typeof job.fitScore === 'number' ? { fitScore: job.fitScore } : {}),
    firstSeenAt: existing?.firstSeenAt ?? lastSeenAt,
    lastSeenAt,
    seenCount: (existing?.seenCount ?? 0) + 1
  };
}

export function upsertCareerSeenLeadRegistry(store: MemoryStore, jobs: JobRecord[], options: UpsertOptions = {}): { changed: number; total: number } {
  const candidates = jobs.filter((job) => job.company.trim() && job.role.trim());
  if (!candidates.length) return { changed: 0, total: careerSeenLeadRegistry(store).length };
  const date = options.date ?? new Date();
  const now = nowIso(date);
  const before = store.settings ? personalSettingsSchema.parse(store.settings) : null;
  const base = before ?? defaultSettings(date);
  const entries = careerSeenLeadRegistry({ settings: base });
  let changed = 0;
  for (const job of candidates) {
    const index = entries.findIndex((entry) => entryMatchesJob(entry, job));
    const existing = index >= 0 ? entries[index] : undefined;
    const next = entryForJob(job, existing, { ...options, date });
    if (index >= 0) entries[index] = next;
    else entries.push(next);
    changed += 1;
  }
  const limit = defaultRegistryLimit;
  const nextEntries = entries.sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)).slice(0, limit);
  const settings = personalSettingsSchema.parse({
    ...base,
    preferences: {
      ...base.preferences,
      careerSeenLeadRegistry: {
        version: 1,
        limit,
        updatedAt: now,
        entries: nextEntries
      }
    },
    deviceId: options.deviceId ?? 'api',
    updatedAt: now
  });
  store.settings = settings;
  appendSyncEvent(store, {
    workspaceId: settings.workspaceId,
    entityType: 'settings',
    entityId: settings.workspaceId,
    operation: 'update',
    payload: before ? withBeforeSnapshot(settings, before, options.reason ?? 'career-seen-lead-registry') : settings,
    deviceId: settings.deviceId
  });
  return { changed, total: nextEntries.length };
}
