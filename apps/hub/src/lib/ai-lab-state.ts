export type AiLabResultState = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface AiLabResultCopy {
  title: string;
  detail: string;
}

export interface AiLabDraftState {
  text: string;
  labels: string;
  codeText: string;
  grammarUrl: string;
}

export const aiLabDraftStorageKey = 'miniHub.aiLab.draft.v1';

export function parseAiLabLabels(value: string): string[] {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

export function normalizeAiLabDraft(value: unknown, fallback: AiLabDraftState): AiLabDraftState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Partial<AiLabDraftState>;
  return {
    text: stringValue(record.text, fallback.text),
    labels: stringValue(record.labels, fallback.labels),
    codeText: stringValue(record.codeText, fallback.codeText),
    grammarUrl: stringValue(record.grammarUrl, fallback.grammarUrl)
  };
}

export function aiLabResultCopy(state: AiLabResultState, detail = ''): AiLabResultCopy {
  if (state === 'loading') {
    return {
      title: 'Running browser-side AI',
      detail: detail || 'Loading local assets. The first run can take a moment while the model or parser initializes.'
    };
  }
  if (state === 'success') {
    return {
      title: 'Result ready',
      detail: detail || 'The browser-side experiment returned output.'
    };
  }
  if (state === 'empty') {
    return {
      title: 'No output returned',
      detail: detail || 'The browser-side experiment ran, but the model or parser did not return inspectable output.'
    };
  }
  if (state === 'error') {
    return {
      title: 'Action needed',
      detail: detail || 'The experiment could not run. Check the inputs, asset URL, browser console, or network access.'
    };
  }
  return {
    title: 'Ready to test',
    detail: 'Run Classify or Parse to test the browser-side Transformers.js and Tree-sitter pieces.'
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
