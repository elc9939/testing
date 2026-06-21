import { describe, expect, it } from 'vitest';
import type { ActionLedgerEntry } from '@mini-hub/core';
import { actionLedgerDetail, buildActionLedgerSnapshot, macroRunToAction, normalizeAiAction } from './action-ledger';

const hubAction: ActionLedgerEntry = {
  id: 'hub:1',
  occurredAt: '2026-06-20T10:00:00.000Z',
  system: 'mini-hub',
  source: 'sync_event',
  actionType: 'job.insert',
  summary: 'Created Job',
  status: 'succeeded',
  risk: 'write',
  changed: ['job:1'],
  recoverability: {
    kind: 'snapshot',
    referenceId: 'sync-1',
    description: 'After-state payload recorded.',
    reversible: false
  },
  rawRef: {},
  metadata: {}
};

describe('action ledger', () => {
  it('normalizes AI OS snake_case entries into the shared ledger shape', () => {
    const action = normalizeAiAction({
      id: 'ai-tool:1',
      occurred_at: '2026-06-20T11:00:00.000Z',
      system: 'ai-os',
      source: 'tool_call',
      action_type: 'study.add_session',
      summary: 'Tool study.add_session blocked',
      status: 'blocked',
      risk: 'write',
      mode: 'quiet',
      changed: ['study.add_session'],
      recoverability: {
        kind: 'none',
        description: 'Confirmation gate blocked this tool before side effects.',
        reversible: true
      },
      raw_ref: { id: 'tool_1' },
      metadata: {}
    });

    expect(action.actionType).toBe('study.add_session');
    expect(action.occurredAt).toBe('2026-06-20T11:00:00.000Z');
    expect(action.recoverability.reversible).toBe(true);
    expect(actionLedgerDetail(action)).toContain('AI OS');
  });

  it('converts Macro Lab dry-runs into recoverable action entries', () => {
    const action = macroRunToAction({
      id: 'run-1',
      macro_id: 'macro-1',
      macro_name: 'Study Mode',
      status: 'succeeded',
      dry_run: true,
      started_at: '2026-06-20T09:00:00.000Z',
      finished_at: '2026-06-20T09:01:00.000Z',
      steps: [{ label: 'Open notes', safety: 'write' }]
    });

    expect(action.status).toBe('dry_run');
    expect(action.risk).toBe('write');
    expect(action.recoverability.kind).toBe('dry_run');
    expect(action.changed).toEqual(['Open notes']);
  });

  it('surfaces Macro Lab file recovery metadata in ledger entries', () => {
    const action = macroRunToAction({
      id: 'run-2',
      macro_id: 'macro-2',
      macro_name: 'Delete temp',
      status: 'succeeded',
      dry_run: false,
      started_at: '2026-06-20T09:00:00.000Z',
      finished_at: '2026-06-20T09:01:00.000Z',
      steps: [
        {
          action_type: 'file.delete',
          label: 'Delete file',
          safety: 'destructive',
          detail: {
            path: 'C:/tmp/delete-me.txt',
            recoverability: {
              kind: 'snapshot',
              reversible: true,
              snapshots: [{ id: 'snap-1', target: 'C:/tmp/delete-me.txt', snapshot_path: 'C:/snap/delete-me.txt' }],
              inverse_operations: [{ operation: 'restore_snapshot', snapshot_id: 'snap-1', target: 'C:/tmp/delete-me.txt' }]
            }
          }
        }
      ]
    });

    expect(action.risk).toBe('destructive');
    expect(action.changed).toEqual(['C:/tmp/delete-me.txt']);
    expect(action.recoverability.kind).toBe('snapshot');
    expect(action.recoverability.reversible).toBe(true);
    expect(action.recoverability.description).toContain('1 snapshot');
  });

  it('merges all sources newest first and preserves service errors', () => {
    const snapshot = buildActionLedgerSnapshot({
      hubActions: [hubAction],
      aiActions: [
        {
          id: 'ai-benchmark:1',
          occurred_at: '2026-06-20T12:00:00.000Z',
          system: 'ai-os',
          source: 'benchmark',
          action_type: 'benchmark.text',
          summary: 'Text benchmark passed',
          status: 'succeeded',
          risk: 'read',
          changed: ['benchmark:1'],
          recoverability: {
            kind: 'snapshot',
            reference_id: 'bench-1',
            description: 'Benchmark snapshot.',
            reversible: false
          },
          raw_ref: {},
          metadata: {}
        }
      ],
      macroRuns: [],
      errors: ['Macro Lab unavailable'],
      limit: 5
    });

    expect(snapshot.actions.map((action) => action.id)).toEqual(['ai-benchmark:1', 'hub:1']);
    expect(snapshot.errors).toEqual(['Macro Lab unavailable']);
  });
});
