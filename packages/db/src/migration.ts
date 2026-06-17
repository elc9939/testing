import {
  jobSchema,
  legacyStorageKeys,
  personalWorkspaceId,
  studySessionSchema,
  type JobRecord,
  type StudySession
} from '@mini-hub/core';

export interface LegacyImportSummary {
  careers: number;
  studyDays: number;
  studySessions: number;
  studyCareerActions: number;
  highScoreGames: number;
  hasTheme: boolean;
  hasStickArenaMap: boolean;
  warnings: string[];
}

type ReadableStorage = Pick<Storage, 'getItem'>;

export interface LegacyEntityImportOptions {
  workspaceId?: string;
  deviceId: string;
  importedAt?: string;
}

export interface LegacyEntityImport {
  snapshot: Record<string, string>;
  summary: LegacyImportSummary;
  jobs: JobRecord[];
  studySessions: StudySession[];
  warnings: string[];
}

const trackNames: Record<string, string> = {
  examP: 'Exam P',
  quant: 'Quant Prep',
  coding: 'Coding Practice'
};

function readJson(storage: ReadableStorage, key: string): unknown {
  const raw = storage.getItem(key);
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).length
    : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function maybeNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isoDateTime(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return `${raw}T12:00:00.000Z`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function dateValue(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;
  return isoDateTime(raw);
}

function stableLegacyId(prefix: string, rawId: unknown, index: number): string {
  const id = text(rawId) || String(index + 1);
  return `${prefix}:${id}`;
}

function noteLine(label: string, value: unknown): string | null {
  if (Array.isArray(value)) {
    const list = stringList(value);
    return list.length ? `${label}: ${list.join(', ')}` : null;
  }
  const valueText = text(value);
  return valueText ? `${label}: ${valueText}` : null;
}

function normalizeCareerStatus(stage: unknown): string {
  const value = text(stage).toLowerCase();
  if (!value || value === 'saved') return 'lead';
  if (value === 'interviewing') return 'interview';
  return value;
}

function buildCareerNotes(job: Record<string, unknown>): string {
  const sections: string[] = [];
  const ownNotes = text(job.notes);
  if (ownNotes) sections.push(ownNotes);

  const details = [
    noteLine('Legacy stage', job.stage),
    noteLine('Priority', job.priority),
    noteLine('Location', job.location),
    noteLine('Work mode', job.workMode),
    noteLine('Job type', job.jobType),
    noteLine('Source', job.source),
    noteLine('Link', job.link),
    noteLine('Deadline', job.deadline),
    noteLine('Date applied', job.dateApplied),
    noteLine('Next action', job.nextAction),
    noteLine('Next action date', job.nextActionDate),
    noteLine('Contact name', job.contactName),
    noteLine('Contact info', job.contactInfo),
    noteLine('Resume version', job.resumeVersion),
    noteLine('Cover letter', job.coverStatus),
    noteLine('Tags', job.tags),
    noteLine('Salary minimum', job.salaryMin),
    noteLine('Salary maximum', job.salaryMax)
  ].filter((line): line is string => Boolean(line));

  if (details.length) sections.push(['Legacy Career Desk details:', ...details.map((line) => `- ${line}`)].join('\n'));

  const description = text(job.description);
  if (description) sections.push(`Legacy description:\n${description}`);

  const history = Array.isArray(job.history)
    ? job.history
        .map((item) => {
          const record = asRecord(item);
          if (!record) return '';
          const at = text(record.at);
          const itemText = text(record.text);
          return itemText ? `${at ? `${at}: ` : ''}${itemText}` : '';
        })
        .filter(Boolean)
    : [];
  if (history.length) sections.push(['Legacy history:', ...history.map((line) => `- ${line}`)].join('\n'));

  return sections.join('\n\n');
}

function convertLegacyJob(value: unknown, index: number, options: Required<LegacyEntityImportOptions>): JobRecord | null {
  const job = asRecord(value);
  if (!job) return null;

  const createdAt = isoDateTime(job.createdAt) ?? options.importedAt;
  const updatedAt = isoDateTime(job.updatedAt) ?? createdAt;
  const parsed = jobSchema.safeParse({
    id: stableLegacyId('legacy-career-job', job.id, index),
    workspaceId: options.workspaceId,
    company: text(job.company) || 'Unknown company',
    role: text(job.title) || text(job.role) || 'Untitled role',
    status: normalizeCareerStatus(job.stage),
    fitScore: maybeNumber(job.fitScore),
    nextActionAt: dateValue(job.nextActionDate) ?? dateValue(job.deadline),
    notes: buildCareerNotes(job),
    deviceId: options.deviceId,
    updatedAt
  });

  return parsed.success ? parsed.data : null;
}

function convertLegacyStudySession(
  value: unknown,
  index: number,
  options: Required<LegacyEntityImportOptions>
): StudySession | null {
  const session = asRecord(value);
  if (!session) return null;
  const minutes = Math.max(0, Math.min(720, Math.round(Number(session.minutes) || 0)));
  if (!minutes) return null;

  const track = text(session.track) || 'examP';
  const trackName = trackNames[track] ?? track;
  const notes = text(session.notes);
  const loggedAt = isoDateTime(session.createdAt) ?? isoDateTime(session.date) ?? options.importedAt;
  const parsed = studySessionSchema.safeParse({
    id: stableLegacyId('legacy-study-session', session.id, index),
    workspaceId: options.workspaceId,
    subject: notes ? `${trackName}: ${notes}` : trackName,
    minutes,
    source: `legacy-study-desk:${track}`,
    loggedAt,
    deviceId: options.deviceId,
    updatedAt: loggedAt
  });

  return parsed.success ? parsed.data : null;
}

function readLegacyJobs(storage: ReadableStorage, warnings: string[]): unknown[] {
  try {
    const value = readJson(storage, legacyStorageKeys.careerJobs);
    return Array.isArray(value) ? value : [];
  } catch {
    warnings.push('Career Desk data exists but could not be parsed.');
    return [];
  }
}

function readLegacyStudyState(storage: ReadableStorage, warnings: string[]): Record<string, unknown> | null {
  try {
    return asRecord(readJson(storage, legacyStorageKeys.studyState));
  } catch {
    warnings.push('Study Desk data exists but could not be parsed.');
    return null;
  }
}

export function inspectLegacyStorage(storage: ReadableStorage): LegacyImportSummary {
  const warnings: string[] = [];
  const careers = readLegacyJobs(storage, warnings).length;
  const study = readLegacyStudyState(storage, warnings);
  const daily = asRecord(study?.daily) ?? asRecord(study?.days);
  const sessions = Array.isArray(study?.sessions) ? study.sessions : [];
  const studyDays = countObjectKeys(daily);
  const studyCareerActions = daily
    ? Object.values(daily).reduce<number>((count, record) => {
        const day = asRecord(record);
        return count + (Array.isArray(day?.careerActions) ? day.careerActions.length : 0);
      }, 0)
    : 0;
  let highScoreGames = 0;

  try {
    highScoreGames = countObjectKeys(readJson(storage, legacyStorageKeys.highScores));
  } catch {
    warnings.push('High-score data exists but could not be parsed.');
  }

  return {
    careers,
    studyDays,
    studySessions: countArray(sessions),
    studyCareerActions,
    highScoreGames,
    hasTheme: Boolean(storage.getItem(legacyStorageKeys.theme)),
    hasStickArenaMap: Boolean(storage.getItem(legacyStorageKeys.stickArenaMap)),
    warnings
  };
}

export function exportLegacySnapshot(storage: ReadableStorage): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of Object.values(legacyStorageKeys)) {
    const value = storage.getItem(key);
    if (value) snapshot[key] = value;
  }
  return snapshot;
}

export function createLegacyEntityImport(storage: ReadableStorage, options: LegacyEntityImportOptions): LegacyEntityImport {
  const importedAt = options.importedAt ?? new Date().toISOString();
  const normalizedOptions: Required<LegacyEntityImportOptions> = {
    workspaceId: options.workspaceId ?? personalWorkspaceId,
    deviceId: options.deviceId,
    importedAt
  };
  const warnings: string[] = [];
  const rawJobs = readLegacyJobs(storage, warnings);
  const study = readLegacyStudyState(storage, warnings);
  const rawStudySessions = Array.isArray(study?.sessions) ? study.sessions : [];
  const jobs = rawJobs
    .map((job, index) => convertLegacyJob(job, index, normalizedOptions))
    .filter((job): job is JobRecord => Boolean(job));
  const studySessions = rawStudySessions
    .map((session, index) => convertLegacyStudySession(session, index, normalizedOptions))
    .filter((session): session is StudySession => Boolean(session));

  if (jobs.length < rawJobs.length) {
    warnings.push(`${rawJobs.length - jobs.length} Career Desk job(s) could not be converted.`);
  }
  if (studySessions.length < rawStudySessions.length) {
    warnings.push(`${rawStudySessions.length - studySessions.length} Study Desk session(s) could not be converted.`);
  }

  const summary = inspectLegacyStorage(storage);
  const combinedWarnings = [...new Set([...summary.warnings, ...warnings])];
  return {
    snapshot: exportLegacySnapshot(storage),
    summary: {
      ...summary,
      warnings: combinedWarnings
    },
    jobs,
    studySessions,
    warnings: combinedWarnings
  };
}
