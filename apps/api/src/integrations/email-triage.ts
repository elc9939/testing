import type { GmailThread } from '@mini-hub/core';
import { env } from '../env';

export type EmailTriageCategory =
  | 'deadline'
  | 'reply'
  | 'career'
  | 'school'
  | 'finance'
  | 'travel'
  | 'personal'
  | 'notification'
  | 'noise';

export interface EmailThreadInsight {
  thread: GmailThread;
  priority: number;
  category: EmailTriageCategory;
  reason: string;
  deadlineHint?: string;
  source: 'ollama' | 'heuristic';
}

interface OllamaTriageResult {
  priority?: unknown;
  category?: unknown;
  reason?: unknown;
  deadlineHint?: unknown;
}

const highSignalTerms = [
  'deadline',
  'due',
  'action required',
  'please reply',
  'respond',
  'interview',
  'application',
  'offer',
  'decision',
  'schedule',
  'appointment',
  'reservation',
  'ticket',
  'confirmation',
  'invoice',
  'payment',
  'security',
  'verification'
];

const careerTerms = ['interview', 'application', 'recruiter', 'hiring', 'offer', 'resume', 'career', 'job'];
const schoolTerms = ['assignment', 'course', 'class', 'exam', 'quiz', 'grade', 'canvas', 'brightspace', 'professor'];
const noiseTerms = [
  'sale',
  'deal',
  'discount',
  'promo',
  'promotion',
  'newsletter',
  'streak',
  'cart',
  'prime day',
  'unsubscribe',
  'view web version'
];

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function threadText(thread: GmailThread): string {
  const latest = thread.messages[thread.messages.length - 1];
  return [thread.subject, thread.from, thread.snippet, latest?.bodyText, latest?.snippet]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function dateHint(text: string): string | undefined {
  const match =
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:today|tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/iu.exec(
      text
    );
  return match?.[0];
}

export function heuristicTriage(thread: GmailThread): EmailThreadInsight {
  const text = threadText(thread);
  const lower = text.toLowerCase();
  let priority = 35;
  let category: EmailTriageCategory = 'notification';
  const reasons: string[] = [];

  if (thread.unread) {
    priority += 8;
    reasons.push('unread');
  }
  if (thread.labelIds.includes('IMPORTANT')) {
    priority += 16;
    reasons.push('Gmail marked important');
  }
  if (includesAny(lower, highSignalTerms)) {
    priority += 24;
    category = 'reply';
    reasons.push('action/deadline language');
  }
  if (includesAny(lower, careerTerms)) {
    priority += 18;
    category = 'career';
    reasons.push('career signal');
  }
  if (includesAny(lower, schoolTerms)) {
    priority += 18;
    category = 'school';
    reasons.push('school signal');
  }
  if (/\b(ticket|reservation|flight|hotel|event|appointment)\b/iu.test(lower)) {
    priority += 14;
    category = 'travel';
    reasons.push('event or booking signal');
  }
  if (/\b(invoice|payment|receipt|refund|charge|security|verification)\b/iu.test(lower)) {
    priority += 12;
    category = 'finance';
    reasons.push('account/payment signal');
  }

  const deadline = dateHint(text);
  if (deadline || /\b(deadline|due|by midnight|expires|appointment)\b/iu.test(lower)) {
    priority += 18;
    category = 'deadline';
    reasons.push(deadline ? `date hint: ${deadline}` : 'deadline hint');
  }

  if (thread.labelIds.some((label) => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(label))) {
    priority -= 18;
    reasons.push('promotional/social category');
  }
  if (includesAny(lower, noiseTerms)) {
    priority -= 22;
    if (priority < 45) category = 'noise';
    reasons.push('likely low-signal marketing');
  }

  const reason = reasons.length ? reasons.slice(0, 3).join(', ') : 'general inbox item';
  return {
    thread,
    priority: clampPriority(priority),
    category,
    reason,
    ...(deadline ? { deadlineHint: deadline } : {}),
    source: 'heuristic'
  };
}

function parseOllamaJson(text: string): OllamaTriageResult | null {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('{') ? trimmed : /\{[\s\S]*\}/u.exec(trimmed)?.[0];
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as OllamaTriageResult;
  } catch {
    return null;
  }
}

async function ollamaTriage(thread: GmailThread): Promise<EmailThreadInsight | null> {
  if (!env.emailTriageAi) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.ollamaChatModel,
        stream: false,
        format: 'json',
        prompt: [
          'Classify this email thread for a private productivity dashboard.',
          'Return compact JSON only with: priority 0-100, category one of deadline/reply/career/school/finance/travel/personal/notification/noise, reason under 14 words, optional deadlineHint.',
          'Prefer high priority only for messages needing action, decisions, deadlines, meetings, school, career, money/account security, or real reservations.',
          threadText(thread)
        ].join('\n\n')
      })
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { response?: unknown };
    const parsed = typeof body.response === 'string' ? parseOllamaJson(body.response) : null;
    if (!parsed) return null;
    const fallback = heuristicTriage(thread);
    const category =
      typeof parsed.category === 'string' &&
      ['deadline', 'reply', 'career', 'school', 'finance', 'travel', 'personal', 'notification', 'noise'].includes(
        parsed.category
      )
        ? (parsed.category as EmailTriageCategory)
        : fallback.category;
    const priority = typeof parsed.priority === 'number' ? parsed.priority : fallback.priority;
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : fallback.reason;
    const deadlineHint =
      typeof parsed.deadlineHint === 'string' && parsed.deadlineHint.trim()
        ? parsed.deadlineHint.trim()
        : fallback.deadlineHint;
    return {
      thread,
      priority: clampPriority(priority),
      category,
      reason,
      ...(deadlineHint ? { deadlineHint } : {}),
      source: 'ollama'
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function triageGmailThreads(
  threads: GmailThread[],
  options: { maxResults?: number; minPriority?: number } = {}
): Promise<EmailThreadInsight[]> {
  const insights = await Promise.all(
    threads.map(async (thread) => (await ollamaTriage(thread)) ?? heuristicTriage(thread))
  );
  return insights
    .filter((insight) => insight.priority >= (options.minPriority ?? 50))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, options.maxResults ?? 10);
}
