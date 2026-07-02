import { afterEach, describe, expect, it } from 'vitest';
import {
  attentionActionLabel,
  attentionActionTimeoutMs,
  attentionSnapshotTimeoutMs,
  attentionSourceStatusLine,
  itemSupportsAction,
  writeAttentionSnapshotCache
} from './attention-store';
import type { AttentionItem, AttentionSnapshot } from '@mini-hub/core';

function item(partial: Partial<AttentionItem>): AttentionItem {
  return {
    id: 'gmail:thread-1',
    source: 'gmail',
    sourceId: 'thread-1',
    title: 'Reply needed',
    detail: 'Recruiter follow-up',
    route: '/productivity',
    priority: 80,
    status: 'active',
    actionKind: 'inspect',
    actions: [
      { kind: 'open', label: 'Open', available: true, requiresOnline: false, risk: 'read' },
      { kind: 'mark_read', label: 'Read', available: true, requiresOnline: true, risk: 'write' },
      {
        kind: 'complete',
        label: 'Complete',
        available: false,
        reason: 'Not supported for Gmail.',
        requiresOnline: true,
        risk: 'write'
      }
    ],
    recoverability: { kind: 'snapshot', description: 'Synced triage state.', reversible: true },
    readOnly: false,
    writable: true,
    metadata: {},
    ...partial
  };
}

describe('attention store helpers', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('keeps empty and unavailable states tied to real source status', () => {
    expect(
      attentionSourceStatusLine({
        id: 'gmail',
        label: 'Gmail',
        status: 'unavailable',
        itemCount: 0,
        error: 'No connected Google account.'
      })
    ).toBe('No connected Google account.');
    expect(
      attentionSourceStatusLine({
        id: 'research',
        label: 'Research',
        status: 'ok',
        itemCount: 0
      })
    ).toBe('0 active');
    expect(
      attentionSourceStatusLine({
        id: 'google_calendar',
        label: 'Google Calendar',
        status: 'error',
        itemCount: 0,
        error: 'Token has been expired or revoked.'
      })
    ).toBe('needs authentication or permission before this action can run.');
    expect(
      attentionSourceStatusLine({
        id: 'ai_os',
        label: 'AI OS',
        status: 'error',
        itemCount: 0,
        error: 'This operation was aborted'
      })
    ).toBe('timed out. Cached data stays visible when available; retry after the service settles.');
  });

  it('only treats available actions as supported', () => {
    expect(itemSupportsAction(item({}), 'mark_read')).toBe(true);
    expect(itemSupportsAction(item({}), 'complete')).toBe(false);
    expect(attentionActionLabel('snooze')).toBe('Snooze');
  });

  it('keeps Today refresh and write calls bounded', () => {
    expect(attentionSnapshotTimeoutMs).toBeGreaterThan(0);
    expect(attentionSnapshotTimeoutMs).toBeLessThan(attentionActionTimeoutMs);
  });

  it('keeps live Today data usable when browser cache storage is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');

    const result = writeAttentionSnapshotCache(snapshot());

    expect(result.cachedAt).toBeUndefined();
    expect(result.error).toContain('Browser attention cache is unavailable');
  });

  it('keeps live Today data usable when browser storage access is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Browser storage blocked');
      }
    });

    const result = writeAttentionSnapshotCache(snapshot());

    expect(result.cachedAt).toBeUndefined();
    expect(result.error).toContain('Browser attention cache is unavailable');
  });

  it('keeps live Today data usable when browser cache writes fail', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error('quota exceeded');
        }
      }
    });

    const result = writeAttentionSnapshotCache(snapshot());

    expect(result.cachedAt).toBeUndefined();
    expect(result.error).toContain('Browser attention cache could not be updated');
  });
});

function snapshot(): AttentionSnapshot {
  return {
    checkedAt: '2026-06-23T10:00:00.000Z',
    items: [],
    sources: [],
    triageState: {},
    errors: []
  };
}
