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

export function aiLabAssetErrorDetail(kind: 'classify' | 'parse', error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = message.toLowerCase();
  const original = message ? ` Original error: ${message}` : '';

  if (kind === 'parse' && /wasm|grammar|language|webassembly/.test(lower)) {
    return `Tree-sitter could not load the configured WASM grammar. Restore Samples or paste a reachable grammar URL.${original}`;
  }

  if (/fetch|network|download|load failed|failed to load|could not load/.test(lower)) {
    return kind === 'classify'
      ? `Transformers.js could not load the local browser model assets. Check network access for the first model download, then try Classify again.${original}`
      : `Tree-sitter could not load its browser parser assets. Check that the grammar URL is reachable from this page, then try Parse again.${original}`;
  }

  if (/indexeddb|quota|cache|storage|opfs/.test(lower)) {
    return `Browser storage or cache access blocked this local AI run. Free storage or allow site storage, then try again.${original}`;
  }

  return kind === 'classify'
    ? `Classification failed before returning labels. This is a browser-local asset or model runtime issue, not an AI OS outage.${original}`
    : `Parsing failed before returning a syntax tree. This is a browser-local Tree-sitter issue, not an AI OS outage.${original}`;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
