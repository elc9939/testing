import {
  careerActionSchema,
  jobSchema,
  legacyStorageKeys,
  personalWorkspaceId,
  studySessionSchema,
  type CareerActionRecord,
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
  careerActions: CareerActionRecord[];
  linkedState: Record<string, unknown>;
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

function dateAtNoonIso(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return `${raw}T12:00:00.000Z`;
  return isoDateTime(raw);
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

function convertCareerAction(input: {
  id: string;
  workspaceId: string;
  jobId?: string | undefined;
  label: string;
  dueAt?: string | undefined;
  completedAt?: string | undefined;
  deviceId: string;
  updatedAt: string;
}): CareerActionRecord | null {
  const parsed = careerActionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function convertLegacyStudyCareerActions(
  study: Record<string, unknown> | null,
  options: Required<LegacyEntityImportOptions>
): CareerActionRecord[] {
  const daily = asRecord(study?.daily) ?? asRecord(study?.days);
  if (!daily) return [];

  return Object.entries(daily).flatMap(([date, value], dayIndex) => {
    const day = asRecord(value);
    const actions = Array.isArray(day?.careerActions) ? day.careerActions : [];
    return actions
      .map((action, actionIndex) => {
        const record = asRecord(action);
        if (!record) return null;
        const kind = text(record.kind) || 'Career action';
        const notes = text(record.notes);
        const completedAt = isoDateTime(record.at) ?? dateAtNoonIso(date) ?? options.importedAt;
        return convertCareerAction({
          id: stableLegacyId('legacy-study-career-action', `${date}:${text(record.id) || actionIndex + 1}`, dayIndex + actionIndex),
          workspaceId: options.workspaceId,
          label: notes ? `${kind}: ${notes}` : kind,
          completedAt,
          deviceId: options.deviceId,
          updatedAt: completedAt
        });
      })
      .filter((action): action is CareerActionRecord => Boolean(action));
  });
}

function convertLegacyJobCareerActions(
  value: unknown,
  index: number,
  options: Required<LegacyEntityImportOptions>
): CareerActionRecord[] {
  const job = asRecord(value);
  if (!job) return [];

  const jobId = stableLegacyId('legacy-career-job', job.id, index);
  const jobKey = text(job.id) || String(index + 1);
  const role = text(job.title) || text(job.role) || 'Untitled role';
  const company = text(job.company) || 'Unknown company';
  const updatedAt = isoDateTime(job.updatedAt) ?? isoDateTime(job.createdAt) ?? options.importedAt;
  const actions: Array<CareerActionRecord | null> = [];

  const dateApplied = dateAtNoonIso(job.dateApplied);
  if (dateApplied) {
    actions.push(
      convertCareerAction({
        id: stableLegacyId('legacy-career-action:applied', jobKey, index),
        workspaceId: options.workspaceId,
        jobId,
        label: `Applied: ${role} at ${company}`,
        completedAt: dateApplied,
        deviceId: options.deviceId,
        updatedAt: dateApplied
      })
    );
  }

  const nextAction = text(job.nextAction);
  const nextActionAt = dateAtNoonIso(job.nextActionDate);
  if (nextAction || nextActionAt) {
    actions.push(
      convertCareerAction({
        id: stableLegacyId('legacy-career-action:next', jobKey, index),
        workspaceId: options.workspaceId,
        jobId,
        label: nextAction ? `Next: ${nextAction}` : `Next action: ${role} at ${company}`,
        dueAt: nextActionAt,
        deviceId: options.deviceId,
        updatedAt
      })
    );
  }

  const deadlineAt = dateAtNoonIso(job.deadline);
  if (deadlineAt && deadlineAt !== nextActionAt) {
    actions.push(
      convertCareerAction({
        id: stableLegacyId('legacy-career-action:deadline', jobKey, index),
        workspaceId: options.workspaceId,
        jobId,
        label: `Deadline: ${role} at ${company}`,
        dueAt: deadlineAt,
        deviceId: options.deviceId,
        updatedAt
      })
    );
  }

  if (Array.isArray(job.history)) {
    job.history.forEach((item, historyIndex) => {
      const record = asRecord(item);
      if (!record) return;
      const label = text(record.text);
      if (!label) return;
      const completedAt = isoDateTime(record.at) ?? updatedAt;
      actions.push(
        convertCareerAction({
          id: stableLegacyId('legacy-career-action:history', `${jobKey}:${historyIndex + 1}:${text(record.at)}`, historyIndex),
          workspaceId: options.workspaceId,
          jobId,
          label,
          completedAt,
          deviceId: options.deviceId,
          updatedAt: completedAt
        })
      );
    });
  }

  return actions.filter((action): action is CareerActionRecord => Boolean(action));
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
  const loggedAt = dateAtNoonIso(session.date) ?? isoDateTime(session.createdAt) ?? options.importedAt;
  const updatedAt = isoDateTime(session.createdAt) ?? loggedAt;
  const parsed = studySessionSchema.safeParse({
    id: stableLegacyId('legacy-study-session', session.id, index),
    workspaceId: options.workspaceId,
    subject: notes ? `${trackName}: ${notes}` : trackName,
    minutes,
    source: `legacy-study-desk:${track}`,
    loggedAt,
    deviceId: options.deviceId,
    updatedAt
  });

  return parsed.success ? parsed.data : null;
}

function legacyCareerJobState(value: unknown, index: number): Record<string, unknown> | null {
  const job = asRecord(value);
  if (!job) return null;
  return {
    id: stableLegacyId('legacy-career-job', job.id, index),
    legacyId: text(job.id) || String(index + 1),
    title: text(job.title) || text(job.role),
    company: text(job.company),
    stage: text(job.stage),
    priority: text(job.priority),
    location: text(job.location),
    workMode: text(job.workMode),
    salaryMin: text(job.salaryMin),
    salaryMax: text(job.salaryMax),
    jobType: text(job.jobType),
    source: text(job.source),
    link: text(job.link),
    deadline: text(job.deadline),
    dateApplied: text(job.dateApplied),
    nextAction: text(job.nextAction),
    nextActionDate: text(job.nextActionDate),
    contactName: text(job.contactName),
    contactInfo: text(job.contactInfo),
    resumeVersion: text(job.resumeVersion),
    coverStatus: text(job.coverStatus),
    tags: stringList(job.tags),
    notes: text(job.notes),
    description: text(job.description),
    historyCount: Array.isArray(job.history) ? job.history.length : 0,
    createdAt: text(job.createdAt),
    updatedAt: text(job.updatedAt)
  };
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

function createLinkedState(
  storage: ReadableStorage,
  rawJobs: unknown[],
  study: Record<string, unknown> | null
): Record<string, unknown> {
  const studyRecord = study ?? {};
  return {
    careerDesk: {
      jobCount: rawJobs.length,
      emailSeeded: storage.getItem(legacyStorageKeys.careerEmailSeed) === '1',
      jobs: rawJobs
        .map((job, index) => legacyCareerJobState(job, index))
        .filter((job): job is Record<string, unknown> => Boolean(job))
    },
    studyDesk: {
      settings: asRecord(studyRecord.settings) ?? {},
      topics: asRecord(studyRecord.topics) ?? {},
      github: asRecord(studyRecord.github) ?? {},
      daily: asRecord(studyRecord.daily) ?? asRecord(studyRecord.days) ?? {}
    }
  };
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
  const careerActions = [
    ...convertLegacyStudyCareerActions(study, normalizedOptions),
    ...rawJobs.flatMap((job, index) => convertLegacyJobCareerActions(job, index, normalizedOptions))
  ];

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
    careerActions,
    linkedState: createLinkedState(storage, rawJobs, study),
    warnings: combinedWarnings
  };
}
