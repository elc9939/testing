import { describe, expect, it } from 'vitest';
import {
  attentionActionLabel,
  attentionActionTimeoutMs,
  attentionSnapshotTimeoutMs,
  attentionSourceStatusLine,
  itemSupportsAction
} from './attention-store';
import type { AttentionItem } from '@mini-hub/core';

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
  it('keeps empty and unavailable states tied to real source status', () => {
    expect(
      attentionSourceStatusLine({
        id: 'gmail',
        label: 'Gmail',
        status: 'unavailable',
        itemCount: 0,
        error: 'No connected Google account.'
      })
    ).toBe('Gmail: No connected Google account.');
    expect(
      attentionSourceStatusLine({
        id: 'research',
        label: 'Research',
        status: 'ok',
        itemCount: 0
      })
    ).toBe('Research: 0 active');
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
});
