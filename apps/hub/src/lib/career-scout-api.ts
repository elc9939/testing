import type { CareerScoutCandidate, JobRecord, PassiveRun, PassiveSnapshot } from '@mini-hub/core';
import { requestApiJson } from './api';

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

export interface CareerScoutResponse {
  candidates: CareerScoutCandidate[];
  summary: CareerScoutSummary;
}

export async function listCareerScoutCandidates(status = '', limit = 80): Promise<CareerScoutResponse> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  return requestApiJson<CareerScoutResponse>(`/api/career-scout?${params.toString()}`);
}

export async function promoteCareerScoutCandidate(candidateId: string): Promise<{ candidate: CareerScoutCandidate; job: JobRecord }> {
  return requestApiJson<{ candidate: CareerScoutCandidate; job: JobRecord }>(
    `/api/career-scout/candidates/${encodeURIComponent(candidateId)}/promote`,
    { method: 'POST' }
  );
}

export async function rejectCareerScoutCandidate(candidateId: string, reason = 'manual-reject'): Promise<{ candidate: CareerScoutCandidate }> {
  return requestApiJson<{ candidate: CareerScoutCandidate }>(`/api/career-scout/candidates/${encodeURIComponent(candidateId)}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason })
  });
}

export async function refineCareerScoutCandidate(
  candidateId: string,
  input: { usePaidProvider?: boolean; costCeilingUsd?: number } = {}
): Promise<{ candidate: CareerScoutCandidate; inserted: boolean; duplicateOf?: string }> {
  return requestApiJson<{ candidate: CareerScoutCandidate; inserted: boolean; duplicateOf?: string }>(
    `/api/career-scout/candidates/${encodeURIComponent(candidateId)}/refine`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }
  );
}

export async function runCareerScoutMaxPowerSearch(): Promise<{
  run: PassiveRun;
  snapshot: PassiveSnapshot;
  summary: CareerScoutSummary;
}> {
  return requestApiJson<{ run: PassiveRun; snapshot: PassiveSnapshot; summary: CareerScoutSummary }>(
    '/api/career-scout/max-power-search',
    { method: 'POST' },
    { timeoutMs: 120_000 }
  );
}
