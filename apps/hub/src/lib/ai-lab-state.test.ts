import { describe, expect, it } from 'vitest';
import { aiLabResultCopy, parseAiLabLabels } from './ai-lab-state';

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
});
