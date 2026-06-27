import { describe, expect, it } from 'vitest';
import {
  aiLabAssetErrorDetail,
  aiLabResultCopy,
  normalizeAiLabDraft,
  parseAiLabLabels,
  type AiLabDraftState
} from './ai-lab-state';

const fallbackDraft: AiLabDraftState = {
  text: 'sample',
  labels: 'career, study',
  codeText: 'const ok = true;',
  grammarUrl: '/tree-sitter-javascript.wasm'
};

describe('AI Lab state helpers', () => {
  it('normalizes comma-separated classifier labels', () => {
    expect(parseAiLabLabels('career, study, , admin')).toEqual(['career', 'study', 'admin']);
    expect(parseAiLabLabels('   ')).toEqual([]);
  });

  it('provides distinct copy for idle, loading, success, empty, and error states', () => {
    expect(aiLabResultCopy('idle').title).toBe('Ready to test');
    expect(aiLabResultCopy('loading').detail).toContain('first run');
    expect(aiLabResultCopy('success', 'career: 0.9').title).toBe('Result ready');
    expect(aiLabResultCopy('empty').title).toBe('No output returned');
    expect(aiLabResultCopy('error', 'Missing grammar').title).toBe('Action needed');
  });

  it('normalizes browser-local draft inputs without trusting malformed storage', () => {
    expect(
      normalizeAiLabDraft(
        {
          text: 'custom text',
          labels: ['not', 'a', 'string'],
          codeText: 'function x() {}',
          grammarUrl: 123
        },
        fallbackDraft
      )
    ).toEqual({
      text: 'custom text',
      labels: fallbackDraft.labels,
      codeText: 'function x() {}',
      grammarUrl: fallbackDraft.grammarUrl
    });

    expect(normalizeAiLabDraft(null, fallbackDraft)).toEqual(fallbackDraft);
  });

  it('turns browser-local asset failures into actionable AI Lab copy', () => {
    expect(aiLabAssetErrorDetail('classify', new Error('Failed to fetch model.json'))).toContain(
      'Transformers.js could not load'
    );
    expect(aiLabAssetErrorDetail('parse', new Error('WebAssembly grammar load failed'))).toContain('configured WASM grammar');
    expect(aiLabAssetErrorDetail('parse', new Error('Quota exceeded'))).toContain('Browser storage or cache access');
    expect(aiLabAssetErrorDetail('classify', new Error('Runtime exploded'))).toContain('not an AI OS outage');
  });
});
