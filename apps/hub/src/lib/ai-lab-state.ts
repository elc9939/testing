export type AiLabResultState = 'idle' | 'loading' | 'success' | 'error';

export interface AiLabResultCopy {
  title: string;
  detail: string;
}

export function parseAiLabLabels(value: string): string[] {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
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
