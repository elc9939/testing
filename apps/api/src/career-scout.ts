import {
  careerScoutCandidateSchema,
  jobSchema,
  personalWorkspaceId,
  routeMap,
  type CareerScoutCandidate,
  type JobRecord
} from '@mini-hub/core';
import { upsertCareerSeenLeadRegistry } from './career-seen-registry';
import {
  appendActionLedgerEvent,
  appendSyncEvent,
  withBeforeSnapshot,
  type MemoryStore
} from './store';

export interface CareerScoutSummary {
  discovered: number;
  plausible: number;
  enriched: number;
  promoted: number;
  rejected: number;
  needsReview: number;
  total: number;
  latestUpdatedAt?: string;
}

export interface CareerScoutUpsertInput {
  id?: string;
  workspaceId?: string;
  status?: CareerScoutCandidate['status'];
  stage?: CareerScoutCandidate['stage'];
  sourceUrl: string;
  canonicalUrl?: string;
  applicationUrl?: string;
  company?: string;
  role?: string;
  location?: string;
  rawTitle?: string;
  rawSummary?: string;
  discoveredQuery?: string;
  discoveredAt?: string;
  researchRunId?: string;
  passiveRunId?: string;
  fitScore?: number;
  confidence?: number;
  rejectionReason?: string;
  rejectionDetail?: string;
  sourceQuality?: string;
  sourceQualityEvidence?: string;
  timingConfidence?: string;
  timingEvidence?: string;
  profileFitConfidence?: string;
  profileFitEvidence?: string;
  deadlineConfidence?: string;
  deadlineEvidence?: string;
  postingDate?: string;
  evidence?: string[];
  structured?: CareerScoutCandidate['structured'];
  modelUsage?: CareerScoutCandidate['modelUsage'];
  metadata?: Record<string, unknown>;
  deviceId?: string;
  updatedAt?: string;
}

export interface CareerScoutUpsertResult {
  candidate: CareerScoutCandidate;
  inserted: boolean;
  duplicateOf?: string;
}

export function canonicalCareerScoutUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export function normalizeCareerScoutText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

export function careerScoutCompanyKey(value: string): string {
  return normalizeCareerScoutText(value)
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|careers|jobs)\b/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function careerScoutCompanyRoleKey(company: string, role: string): string {
  return `${careerScoutCompanyKey(company)}|${normalizeCareerScoutText(role)}`;
}

export function careerScoutCandidateFingerprint(candidate: Pick<CareerScoutCandidate, 'company' | 'role' | 'applicationUrl' | 'sourceUrl'>): string {
  const url = candidate.applicationUrl || candidate.sourceUrl;
  const urlKey = url ? canonicalCareerScoutUrl(url) : '';
  if (urlKey) return `url:${urlKey}`;
  return `company-role:${careerScoutCompanyRoleKey(candidate.company, candidate.role)}`;
}

function candidateDuplicateIndex(store: MemoryStore, input: CareerScoutUpsertInput): number {
  const urlKey = canonicalCareerScoutUrl(input.applicationUrl || input.sourceUrl);
  const companyRoleKey = input.company && input.role ? careerScoutCompanyRoleKey(input.company, input.role) : '';
  return store.careerScoutCandidates.findIndex((candidate) => {
    if (candidate.id === input.id) return true;
    const candidateUrlKey = canonicalCareerScoutUrl(candidate.applicationUrl || candidate.sourceUrl);
    if (urlKey && candidateUrlKey === urlKey) return true;
    return Boolean(companyRoleKey && candidate.company && candidate.role && careerScoutCompanyRoleKey(candidate.company, candidate.role) === companyRoleKey);
  });
}

function mergedMetadata(existing: CareerScoutCandidate | undefined, input: CareerScoutUpsertInput, now: string): Record<string, unknown> {
  const seenCount = Number(existing?.metadata.seenCount);
  return {
    ...(existing?.metadata ?? {}),
    ...(input.metadata ?? {}),
    seenCount: Number.isFinite(seenCount) ? seenCount + 1 : 1,
    lastSeenAt: now
  };
}

export function upsertCareerScoutCandidate(
  store: MemoryStore,
  input: CareerScoutUpsertInput,
  date = new Date()
): CareerScoutUpsertResult {
  const now = date.toISOString();
  const existingIndex = candidateDuplicateIndex(store, input);
  const existing = existingIndex >= 0 ? store.careerScoutCandidates[existingIndex] : undefined;
  const candidate = careerScoutCandidateSchema.parse({
    ...(existing ?? {}),
    id: existing?.id ?? input.id ?? `career-scout-candidate:${crypto.randomUUID()}`,
    workspaceId: input.workspaceId ?? existing?.workspaceId ?? personalWorkspaceId,
    status: input.status ?? existing?.status ?? 'discovered',
    stage: input.stage ?? existing?.stage ?? 'wide_discovery',
    sourceUrl: input.sourceUrl || existing?.sourceUrl,
    canonicalUrl: input.canonicalUrl ?? existing?.canonicalUrl ?? canonicalCareerScoutUrl(input.sourceUrl),
    applicationUrl: input.applicationUrl ?? existing?.applicationUrl ?? input.sourceUrl,
    company: input.company ?? existing?.company ?? '',
    role: input.role ?? existing?.role ?? '',
    location: input.location ?? existing?.location ?? '',
    rawTitle: input.rawTitle ?? existing?.rawTitle ?? '',
    rawSummary: input.rawSummary ?? existing?.rawSummary ?? '',
    discoveredQuery: input.discoveredQuery ?? existing?.discoveredQuery ?? '',
    discoveredAt: input.discoveredAt ?? existing?.discoveredAt ?? now,
    researchRunId: input.researchRunId ?? existing?.researchRunId,
    passiveRunId: input.passiveRunId ?? existing?.passiveRunId,
    fitScore: input.fitScore ?? existing?.fitScore,
    confidence: input.confidence ?? existing?.confidence ?? 0.5,
    rejectionReason: input.rejectionReason ?? existing?.rejectionReason,
    rejectionDetail: input.rejectionDetail ?? existing?.rejectionDetail,
    sourceQuality: input.sourceQuality ?? existing?.sourceQuality ?? 'unknown',
    sourceQualityEvidence: input.sourceQualityEvidence ?? existing?.sourceQualityEvidence ?? '',
    timingConfidence: input.timingConfidence ?? existing?.timingConfidence ?? 'unknown',
    timingEvidence: input.timingEvidence ?? existing?.timingEvidence ?? '',
    profileFitConfidence: input.profileFitConfidence ?? existing?.profileFitConfidence ?? 'unknown',
    profileFitEvidence: input.profileFitEvidence ?? existing?.profileFitEvidence ?? '',
    deadlineConfidence: input.deadlineConfidence ?? existing?.deadlineConfidence ?? 'unknown',
    deadlineEvidence: input.deadlineEvidence ?? existing?.deadlineEvidence ?? '',
    postingDate: input.postingDate ?? existing?.postingDate,
    evidence: input.evidence ?? existing?.evidence ?? [],
    structured: {
      ...(existing?.structured ?? {}),
      ...(input.structured ?? {})
    },
    modelUsage: {
      ...(existing?.modelUsage ?? { costUsd: 0 }),
      ...(input.modelUsage ?? {})
    },
    promotedJobId: existing?.promotedJobId,
    reviewedAt: existing?.reviewedAt,
    metadata: mergedMetadata(existing, input, now),
    deviceId: input.deviceId ?? existing?.deviceId ?? 'career-scout',
    updatedAt: input.updatedAt ?? now
  });

  if (existingIndex >= 0) {
    store.careerScoutCandidates[existingIndex] = candidate;
  } else {
    store.careerScoutCandidates.unshift(candidate);
  }
  appendSyncEvent(store, {
    workspaceId: candidate.workspaceId,
    entityType: 'career_scout_candidate',
    entityId: candidate.id,
    operation: existing ? 'update' : 'insert',
    payload: existing ? withBeforeSnapshot(candidate, existing, 'career-scout-upsert') : candidate,
    deviceId: candidate.deviceId
  });
  return existing ? { candidate, inserted: false, duplicateOf: existing.id } : { candidate, inserted: true };
}

export function careerScoutSummary(candidates: CareerScoutCandidate[]): CareerScoutSummary {
  const summary: CareerScoutSummary = {
    discovered: 0,
    plausible: 0,
    enriched: 0,
    promoted: 0,
    rejected: 0,
    needsReview: 0,
    total: candidates.length
  };
  for (const candidate of candidates) {
    if (candidate.status === 'discovered') summary.discovered += 1;
    if (candidate.status === 'plausible') summary.plausible += 1;
    if (candidate.status === 'enriched') summary.enriched += 1;
    if (candidate.status === 'promoted') summary.promoted += 1;
    if (candidate.status === 'rejected') summary.rejected += 1;
    if (candidate.status === 'needs_review') summary.needsReview += 1;
    if (!summary.latestUpdatedAt || candidate.updatedAt > summary.latestUpdatedAt) summary.latestUpdatedAt = candidate.updatedAt;
  }
  return summary;
}

export function promoteCareerScoutCandidate(
  store: MemoryStore,
  candidateId: string,
  date = new Date()
): { candidate: CareerScoutCandidate; job: JobRecord } {
  const index = store.careerScoutCandidates.findIndex((candidate) => candidate.id === candidateId);
  if (index < 0) throw new Error('Career Scout candidate not found.');
  const existing = store.careerScoutCandidates[index]!;
  if (existing.status === 'promoted' && existing.promotedJobId) {
    const job = store.jobs.find((item) => item.id === existing.promotedJobId);
    if (job) return { candidate: existing, job };
  }
  if (!existing.company.trim() || !existing.role.trim()) throw new Error('Candidate needs a company and role before promotion.');
  const now = date.toISOString();
  const reviewDate = new Date(date.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const notes = [
    `Promoted from Career Scout candidate pool (${existing.id}).`,
    existing.rawTitle ? `Source title: ${existing.rawTitle}` : '',
    existing.rawSummary ? `Source summary: ${existing.rawSummary}` : '',
    `Source: ${existing.applicationUrl || existing.sourceUrl}`,
    `Source quality: ${existing.sourceQuality} (${existing.sourceQualityEvidence})`,
    `Timing confidence: ${existing.timingConfidence} (${existing.timingEvidence})`,
    `Profile fit: ${existing.profileFitConfidence} (${existing.profileFitEvidence})`,
    `Deadline confidence: ${existing.deadlineConfidence} (${existing.deadlineEvidence})`,
    existing.postingDate ? `Posting date: ${existing.postingDate}` : '',
    existing.evidence.length ? `Fit evidence: ${existing.evidence.join('; ')}` : '',
    `Career Scout metadata: ${JSON.stringify({
      sourceQuality: existing.sourceQuality,
      timingConfidence: existing.timingConfidence,
      profileFitConfidence: existing.profileFitConfidence,
      deadlineConfidence: existing.deadlineConfidence,
      candidateId: existing.id
    })}`
  ]
    .filter(Boolean)
    .join('\n');
  const job = jobSchema.parse({
    id: `career-job:${crypto.randomUUID()}`,
    workspaceId: existing.workspaceId,
    company: existing.company,
    role: existing.role,
    status: 'lead',
    applicationUrl: existing.applicationUrl || existing.sourceUrl,
    fitScore: existing.fitScore,
    nextActionAt: reviewDate,
    notes,
    deviceId: 'career-scout',
    updatedAt: now
  });
  store.jobs.push(job);
  appendSyncEvent(store, {
    workspaceId: job.workspaceId,
    entityType: 'job',
    entityId: job.id,
    operation: 'insert',
    payload: job,
    deviceId: job.deviceId
  });
  upsertCareerSeenLeadRegistry(store, [job], {
    deviceId: 'career-scout',
    reason: 'career-scout-promote-seen-registry',
    source: 'career-scout',
    date
  });
  const candidate = careerScoutCandidateSchema.parse({
    ...existing,
    status: 'promoted',
    stage: 'manual_review',
    promotedJobId: job.id,
    reviewedAt: now,
    deviceId: 'career-scout',
    updatedAt: now
  });
  store.careerScoutCandidates[index] = candidate;
  appendSyncEvent(store, {
    workspaceId: candidate.workspaceId,
    entityType: 'career_scout_candidate',
    entityId: candidate.id,
    operation: 'update',
    payload: withBeforeSnapshot(candidate, existing, 'career-scout-promote'),
    deviceId: candidate.deviceId
  });
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'career-scout',
    actionType: 'career_scout.promote_candidate',
    summary: `Promoted ${candidate.company} - ${candidate.role} from Career Scout to Career Desk.`,
    status: 'succeeded',
    risk: 'write',
    changed: [`career_scout_candidate:${candidate.id}`, `job:${job.id}`],
    recoverability: {
      kind: 'snapshot',
      referenceId: candidate.id,
      route: routeMap.careerDesk,
      description: 'Candidate promotion created a normal Career Desk job row and preserved the candidate record.',
      reversible: true
    },
    rawRef: { candidateId: candidate.id, jobId: job.id },
    metadata: { fitScore: candidate.fitScore, sourceQuality: candidate.sourceQuality }
  });
  return { candidate, job };
}

export function rejectCareerScoutCandidate(
  store: MemoryStore,
  candidateId: string,
  reason = 'manual-reject',
  date = new Date()
): CareerScoutCandidate {
  const index = store.careerScoutCandidates.findIndex((candidate) => candidate.id === candidateId);
  if (index < 0) throw new Error('Career Scout candidate not found.');
  const existing = store.careerScoutCandidates[index]!;
  const now = date.toISOString();
  const candidate = careerScoutCandidateSchema.parse({
    ...existing,
    status: 'rejected',
    stage: 'manual_review',
    rejectionReason: reason,
    reviewedAt: now,
    deviceId: 'career-scout',
    updatedAt: now
  });
  store.careerScoutCandidates[index] = candidate;
  appendSyncEvent(store, {
    workspaceId: candidate.workspaceId,
    entityType: 'career_scout_candidate',
    entityId: candidate.id,
    operation: 'update',
    payload: withBeforeSnapshot(candidate, existing, 'career-scout-reject'),
    deviceId: candidate.deviceId
  });
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'career-scout',
    actionType: 'career_scout.reject_candidate',
    summary: `Rejected Career Scout candidate ${candidate.company || candidate.rawTitle || candidate.id}.`,
    status: 'succeeded',
    risk: 'write',
    changed: [`career_scout_candidate:${candidate.id}`],
    recoverability: {
      kind: 'snapshot',
      referenceId: candidate.id,
      route: routeMap.careerDesk,
      description: 'Rejected candidate remains in the pool and can be inspected later.',
      reversible: true
    },
    rawRef: { candidateId: candidate.id },
    metadata: { reason }
  });
  return candidate;
}
