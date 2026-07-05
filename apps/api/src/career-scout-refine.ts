import { routeMap, type CareerScoutCandidate } from '@mini-hub/core';
import { upsertCareerScoutCandidate, type CareerScoutUpsertInput, type CareerScoutUpsertResult } from './career-scout';
import { env } from './env';
import { appendActionLedgerEvent, type MemoryStore } from './store';

type FetchLike = typeof fetch;

interface CareerScoutRefineOptions {
  externalFetch?: FetchLike;
  usePaidProvider: boolean;
  costCeilingUsd: number;
  date?: Date;
}

interface AiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface AiInferenceResult {
  provider?: string;
  model?: string;
  text?: string;
  usage?: AiUsage;
  latency_ms?: number;
  cost_usd?: number;
  fallback_chain?: unknown[];
  metadata?: Record<string, unknown>;
}

interface ParsedCareerRefinement {
  company?: string;
  role?: string;
  location?: string;
  startDate?: string;
  graduationEligibility?: string;
  degreeRequirements?: string;
  workAuthorizationHints?: string;
  applicationDeadline?: string;
  officialApplyUrl?: string;
  sourceQuality?: string;
  sourceQualityEvidence?: string;
  timingConfidence?: string;
  timingEvidence?: string;
  profileFitConfidence?: string;
  profileFitEvidence?: string;
  deadlineConfidence?: string;
  deadlineEvidence?: string;
  fitScore?: number;
  confidence?: number;
  fitRationale?: string;
  rejectionReason?: string;
  rejectionDetail?: string;
  evidence?: string[];
}

export interface CareerScoutRefineResult extends CareerScoutUpsertResult {
  refinement: {
    provider: string;
    model: string;
    costUsd: number;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    fallback: boolean;
    fetchError?: string;
    inferenceError?: string;
  };
}

const maxPageTextChars = 12_000;
const pageFetchTimeoutMs = 10_000;
const inferenceTimeoutMs = 90_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric === undefined) return undefined;
  return Math.max(min, Math.min(max, numeric));
}

function stringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, limit);
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ''));
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

async function fetchCandidatePage(fetchImpl: FetchLike, candidate: CareerScoutCandidate): Promise<{ text: string; url: string; error?: string }> {
  const url = candidate.applicationUrl || candidate.sourceUrl;
  if (!url) return { text: '', url: '', error: 'Candidate has no source URL.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), pageFetchTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.5',
        'user-agent': 'MiniHubCareerScout/0.1'
      },
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      return { text: '', url, error: `Source page returned ${response.status}: ${body.slice(0, 160) || response.statusText}` };
    }
    const normalized = response.headers.get('content-type')?.includes('html') ? stripHtml(body) : body.replace(/\s+/gu, ' ').trim();
    return { text: normalized.slice(0, maxPageTextChars), url };
  } catch (error) {
    return { text: '', url, error: error instanceof Error ? error.message : 'Source page fetch failed.' };
  } finally {
    clearTimeout(timer);
  }
}

function profileForPrompt(): Record<string, unknown> {
  return {
    education: ['B.S. Math May 2026', 'M.S. Math expected May 2027'],
    targetStart: 'May 2027 or Summer 2027',
    targetRoles: ['math', 'computer science', 'data', 'quant', 'analytics', 'product', 'AI-adjacent'],
    rejectIf: [
      'requires graduation before May 2027 when no graduate eligibility is shown',
      'start date is not May/Summer 2027 or clearly compatible',
      'senior/staff/manager role requiring multiple years of full-time experience',
      'no official company or ATS application source'
    ]
  };
}

function promptFor(candidate: CareerScoutCandidate, pageText: string, pageError?: string): string {
  return JSON.stringify(
    {
      task: 'Refine and rank this career candidate for a private Career Scout pipeline. Return only one JSON object.',
      output_schema: {
        company: 'string or empty',
        role: 'string or empty',
        location: 'string or empty',
        startDate: 'string or empty',
        graduationEligibility: 'string or empty',
        degreeRequirements: 'string or empty',
        workAuthorizationHints: 'string or empty',
        applicationDeadline: 'string or empty',
        officialApplyUrl: 'string or empty',
        sourceQuality: 'direct-career-page | ats-posting | job-board | unclear | unknown',
        sourceQualityEvidence: 'short quote/paraphrase or empty',
        timingConfidence: 'high | medium | low | unknown',
        timingEvidence: 'short evidence or empty',
        profileFitConfidence: 'high | medium | low | unknown',
        profileFitEvidence: 'short evidence or empty',
        deadlineConfidence: 'high | medium | unknown',
        deadlineEvidence: 'short evidence or empty',
        fitScore: '0-100 number',
        confidence: '0-1 number',
        fitRationale: 'one concise sentence',
        rejectionReason: 'empty unless clearly wrong-start-date, wrong-graduation-year, qualification-mismatch, seniority-mismatch, weak-source, or weak-profile-fit',
        rejectionDetail: 'short reason if rejected',
        evidence: ['up to 5 short evidence strings']
      },
      rules: [
        'Never invent details. Use empty strings and unknown confidence when evidence is missing.',
        'Prefer official company career pages and ATS postings over job boards/listicles.',
        'A clean candidate should match May/Summer 2027 start or clearly allow May 2027 graduates.',
        'Be strict about seniority and graduation/start-date mismatch.'
      ],
      profile: profileForPrompt(),
      candidate: {
        id: candidate.id,
        company: candidate.company,
        role: candidate.role,
        location: candidate.location,
        rawTitle: candidate.rawTitle,
        rawSummary: candidate.rawSummary,
        applicationUrl: candidate.applicationUrl,
        sourceUrl: candidate.sourceUrl,
        currentFitScore: candidate.fitScore,
        currentEvidence: candidate.evidence
      },
      page: {
        url: candidate.applicationUrl || candidate.sourceUrl,
        fetchError: pageError || '',
        text: pageText
      }
    },
    null,
    2
  );
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function parsedRefinementFromText(value: string): ParsedCareerRefinement | null {
  const parsed = extractJsonObject(value);
  if (!parsed) return null;
  const refinement: ParsedCareerRefinement = {};
  for (const key of [
    'company',
    'role',
    'location',
    'startDate',
    'graduationEligibility',
    'degreeRequirements',
    'workAuthorizationHints',
    'applicationDeadline',
    'officialApplyUrl',
    'sourceQuality',
    'sourceQualityEvidence',
    'timingConfidence',
    'timingEvidence',
    'profileFitConfidence',
    'profileFitEvidence',
    'deadlineConfidence',
    'deadlineEvidence',
    'fitRationale',
    'rejectionReason',
    'rejectionDetail'
  ] as const) {
    const valueForKey = text(parsed[key]);
    if (valueForKey) refinement[key] = valueForKey;
  }
  const score = boundedNumber(parsed.fitScore, 0, 100);
  if (score !== undefined) refinement.fitScore = Math.round(score);
  const confidence = boundedNumber(parsed.confidence, 0, 1);
  if (confidence !== undefined) refinement.confidence = confidence;
  const evidence = stringArray(parsed.evidence, 5);
  if (evidence.length) refinement.evidence = evidence;
  return refinement;
}

async function callAiOsRefinement(
  fetchImpl: FetchLike,
  candidate: CareerScoutCandidate,
  page: { text: string; error?: string },
  options: CareerScoutRefineOptions
): Promise<{ result?: AiInferenceResult; parsed?: ParsedCareerRefinement; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), inferenceTimeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json'
    };
    if (env.bridgeToken) headers['x-mini-hub-bridge-token'] = env.bridgeToken;
    const response = await fetchImpl(new URL('/api/ai/infer', env.aiOsApiUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task_type: 'career.refine_rank',
        messages: [
          {
            role: 'system',
            content:
              'You are a strict career posting extractor and ranker. Return only valid JSON matching the requested schema. Unknown is better than invented.'
          },
          { role: 'user', content: promptFor(candidate, page.text, page.error) }
        ],
        temperature: 0.1,
        max_tokens: 900,
        local_first: true,
        allow_fallback: options.usePaidProvider,
        cost_ceiling_usd: options.usePaidProvider ? options.costCeilingUsd : 0,
        metadata: {
          feature: 'career-scout',
          candidate_id: candidate.id,
          paid_provider_allowed: options.usePaidProvider,
          cost_ceiling_usd: options.costCeilingUsd
        }
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) return { error: `AI OS returned ${response.status}: ${raw.slice(0, 200) || response.statusText}` };
    if (raw.trimStart().startsWith('<')) return { error: 'AI OS returned HTML instead of JSON. Check AI_OS_API_URL.' };
    const payload = JSON.parse(raw) as unknown;
    const result = isRecord(payload) && isRecord(payload.result) ? (payload.result as AiInferenceResult) : undefined;
    if (!result) return { error: 'AI OS inference response was missing result.' };
    const parsed = parsedRefinementFromText(text(result.text));
    return parsed ? { result, parsed } : { result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'AI OS inference failed.' };
  } finally {
    clearTimeout(timer);
  }
}

function statusFor(candidate: CareerScoutCandidate, refinement: ParsedCareerRefinement | undefined): CareerScoutCandidate['status'] {
  if (refinement?.rejectionReason) return 'rejected';
  const score = refinement?.fitScore ?? candidate.fitScore ?? 0;
  const sourceQuality = refinement?.sourceQuality || candidate.sourceQuality;
  const timing = refinement?.timingConfidence || candidate.timingConfidence;
  const profile = refinement?.profileFitConfidence || candidate.profileFitConfidence;
  if (score >= 72 && ['direct-career-page', 'ats-posting'].includes(sourceQuality) && timing !== 'low' && profile !== 'low') return 'enriched';
  return 'needs_review';
}

function buildUpdateInput(
  candidate: CareerScoutCandidate,
  refinement: ParsedCareerRefinement | undefined,
  page: { text: string; url: string; error?: string },
  inference: { result?: AiInferenceResult; error?: string },
  options: CareerScoutRefineOptions
): CareerScoutUpsertInput {
  const result = inference.result;
  const usage = result?.usage ?? {};
  const input: CareerScoutUpsertInput = {
    id: candidate.id,
    workspaceId: candidate.workspaceId,
    sourceUrl: candidate.sourceUrl,
    status: statusFor(candidate, refinement),
    stage: 'refine_rank',
    metadata: {
      ...candidate.metadata,
      ...compactRecord({
        refinedAt: (options.date ?? new Date()).toISOString(),
        refineSourceUrl: page.url,
        refinePageChars: page.text.length,
        refineFetchError: page.error,
        refineInferenceError: inference.error,
        paidProviderAllowed: options.usePaidProvider,
        costCeilingUsd: options.costCeilingUsd,
        refineStatus: result ? 'ai-os-inference' : 'local-fallback'
      })
    },
    modelUsage: {
      provider: result?.provider ?? 'local-rules',
      model: result?.model ?? 'career-scout-rules-v1',
      costUsd: finiteNumber(result?.cost_usd) ?? 0,
      latencyMs: finiteNumber(result?.latency_ms),
      inputTokens: Number.isFinite(usage.input_tokens) ? Number(usage.input_tokens) : undefined,
      outputTokens: Number.isFinite(usage.output_tokens) ? Number(usage.output_tokens) : undefined
    },
    deviceId: 'career-scout'
  };
  if (refinement?.company) input.company = refinement.company;
  if (refinement?.role) input.role = refinement.role;
  if (refinement?.location) input.location = refinement.location;
  if (refinement?.officialApplyUrl) input.applicationUrl = refinement.officialApplyUrl;
  if (refinement?.fitScore !== undefined) input.fitScore = refinement.fitScore;
  if (refinement?.confidence !== undefined) input.confidence = refinement.confidence;
  if (refinement?.rejectionReason) input.rejectionReason = refinement.rejectionReason;
  if (refinement?.rejectionDetail) input.rejectionDetail = refinement.rejectionDetail;
  if (refinement?.sourceQuality) input.sourceQuality = refinement.sourceQuality;
  if (refinement?.sourceQualityEvidence) input.sourceQualityEvidence = refinement.sourceQualityEvidence;
  if (refinement?.timingConfidence) input.timingConfidence = refinement.timingConfidence;
  if (refinement?.timingEvidence) input.timingEvidence = refinement.timingEvidence;
  if (refinement?.profileFitConfidence) input.profileFitConfidence = refinement.profileFitConfidence;
  if (refinement?.profileFitEvidence) input.profileFitEvidence = refinement.profileFitEvidence;
  if (refinement?.deadlineConfidence) input.deadlineConfidence = refinement.deadlineConfidence;
  if (refinement?.deadlineEvidence) input.deadlineEvidence = refinement.deadlineEvidence;
  if (refinement?.evidence?.length) input.evidence = refinement.evidence;
  input.structured = compactRecord({
    ...candidate.structured,
    startDate: refinement?.startDate,
    graduationEligibility: refinement?.graduationEligibility,
    degreeRequirements: refinement?.degreeRequirements,
    workAuthorizationHints: refinement?.workAuthorizationHints,
    applicationDeadline: refinement?.applicationDeadline,
    officialApplyUrl: refinement?.officialApplyUrl,
    fitRationale: refinement?.fitRationale
  });
  return input;
}

export async function refineCareerScoutCandidateWithAi(
  store: MemoryStore,
  candidateId: string,
  options: CareerScoutRefineOptions
): Promise<CareerScoutRefineResult> {
  const candidate = store.careerScoutCandidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error('Career Scout candidate not found.');
  const fetchImpl = options.externalFetch ?? fetch;
  const page = await fetchCandidatePage(fetchImpl, candidate);
  const inference = await callAiOsRefinement(fetchImpl, candidate, page, options);
  const update = buildUpdateInput(candidate, inference.parsed, page, inference, options);
  const result = upsertCareerScoutCandidate(store, update, options.date);
  const refined = result.candidate;
  const costUsd = finiteNumber(inference.result?.cost_usd) ?? 0;
  appendActionLedgerEvent(store, {
    system: 'mini-hub',
    source: 'career-scout',
    actionType: 'career_scout.refine_candidate',
    summary: `Refined ${refined.company || refined.rawTitle || refined.id} with ${inference.result?.provider ?? 'local fallback'}.`,
    status: inference.result ? 'succeeded' : 'info',
    risk: 'write',
    changed: [`career_scout_candidate:${refined.id}`],
    recoverability: {
      kind: 'snapshot',
      referenceId: refined.id,
      route: routeMap.careerDesk,
      description: 'Candidate refinement updates the durable Career Scout pool record; the candidate can still be promoted or rejected later.',
      reversible: true
    },
    rawRef: { candidateId: refined.id, provider: inference.result?.provider, model: inference.result?.model },
    metadata: compactRecord({
      costUsd,
      costCeilingUsd: options.costCeilingUsd,
      paidProviderAllowed: options.usePaidProvider,
      latencyMs: inference.result?.latency_ms,
      inputTokens: inference.result?.usage?.input_tokens,
      outputTokens: inference.result?.usage?.output_tokens,
      fetchError: page.error,
      inferenceError: inference.error
    })
  });
  const refinement: CareerScoutRefineResult['refinement'] = {
    provider: inference.result?.provider ?? 'local-rules',
    model: inference.result?.model ?? 'career-scout-rules-v1',
    costUsd,
    latencyMs: finiteNumber(inference.result?.latency_ms) ?? 0,
    fallback: !inference.result
  };
  const inputTokens = finiteNumber(inference.result?.usage?.input_tokens);
  const outputTokens = finiteNumber(inference.result?.usage?.output_tokens);
  if (inputTokens !== undefined) refinement.inputTokens = inputTokens;
  if (outputTokens !== undefined) refinement.outputTokens = outputTokens;
  if (page.error) refinement.fetchError = page.error;
  if (inference.error) refinement.inferenceError = inference.error;
  return {
    ...result,
    refinement
  };
}
