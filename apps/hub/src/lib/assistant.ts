import { routeMap } from '@mini-hub/core';

export type AssistantTopic = 'assistant' | 'ai-lab' | 'ai-os';

export type AssistantIntent =
  | { kind: 'navigate'; route: string; label: string }
  | { kind: 'explain'; topic: AssistantTopic }
  | { kind: 'status' }
  | { kind: 'local-summary' }
  | { kind: 'memory-search'; query: string }
  | { kind: 'command' }
  | { kind: 'chat' };

const appDestinations: Array<{ route: string; label: string; terms: string[] }> = [
  { route: routeMap.today, label: 'Today', terms: ['today', 'home', 'dashboard', 'command center'] },
  { route: routeMap.productivity, label: 'Productivity Hub', terms: ['productivity', 'gmail', 'email', 'calendar', 'drive', 'hub'] },
  { route: routeMap.careerDesk, label: 'Career Desk', terms: ['career', 'job', 'jobs', 'applications', 'apply list'] },
  { route: routeMap.studyDesk, label: 'Study Desk', terms: ['study', 'coursework', 'school', 'homework'] },
  { route: routeMap.analytics, label: 'Analytics', terms: ['analytics', 'charts', 'data'] },
  { route: routeMap.aiLab, label: 'AI Lab', terms: ['ai lab', 'local intelligence', 'transformers', 'tree sitter', 'tree-sitter'] },
  { route: routeMap.aiOs, label: 'AI OS', terms: ['ai os', 'capability', 'capabilities', 'providers', 'agents'] },
  { route: routeMap.macroLab, label: 'Macro Lab', terms: ['macro', 'macros', 'automation'] },
  { route: routeMap.games, label: 'Games', terms: ['games', 'stick arena'] },
  { route: routeMap.settings, label: 'Settings', terms: ['settings', 'preferences', 'theme'] }
];

export function resolveAssistantIntent(rawInput: string, forceToolMode = false): AssistantIntent {
  const input = rawInput.trim();
  const normalized = input.toLowerCase();
  if (!normalized) return { kind: 'chat' };

  if (asksAboutAssistant(normalized)) return { kind: 'explain', topic: 'assistant' };
  if (asksAboutAiLab(normalized)) return { kind: 'explain', topic: 'ai-lab' };
  if (asksAboutAiOs(normalized)) return { kind: 'explain', topic: 'ai-os' };
  if (asksForStatus(normalized)) return { kind: 'status' };
  if (asksForLocalSummary(normalized)) return { kind: 'local-summary' };

  const memoryQuery = memorySearchQuery(input);
  if (memoryQuery) return { kind: 'memory-search', query: memoryQuery };

  const destination = navigationDestination(normalized);
  if (destination) return { kind: 'navigate', route: destination.route, label: destination.label };

  if (forceToolMode || looksLikeAppCommand(normalized)) return { kind: 'command' };
  return { kind: 'chat' };
}

export function assistantExplanation(topic: AssistantTopic): string {
  if (topic === 'ai-lab') {
    return [
      'AI Lab is the small browser-side experiment bench.',
      'Use it when you want to try local text classification with Transformers.js or parse code with Tree-sitter without touching the heavier system controls.',
      'Think of it as a sandbox: quick experiments, low stakes, mostly read-only.'
    ].join('\n\n');
  }

  if (topic === 'ai-os') {
    return [
      'AI OS is the backend capability console for your local-first AI stack.',
      'It checks which providers are reachable, routes prompts across Ollama and optional paid APIs, runs queued jobs, searches semantic memory, exposes app tools, tests multimodal adapters, tracks usage, and shows health/backups.',
      'Use AI OS when you want to inspect the machinery directly. Use this side assistant when you want to ask for something in normal language.'
    ].join('\n\n');
  }

  return [
    'This assistant is the friendly front door.',
    'It can open parts of the app, explain AI Lab or AI OS, summarize cached hub data, search semantic memory, check provider status, generate media files through AI OS, and hand tool-backed requests to AI OS.',
    'Write actions and macro runs stay behind confirmation so it can help without quietly changing things.'
  ].join('\n\n');
}

function asksAboutAssistant(input: string): boolean {
  return /\b(what can you do|help|assistant|chatbot|side chat)\b/u.test(input);
}

function asksAboutAiLab(input: string): boolean {
  return /\b(what is|explain|understand|how.*use)\b/u.test(input) && /\b(ai lab|transformers|tree[- ]?sitter)\b/u.test(input);
}

function asksAboutAiOs(input: string): boolean {
  return /\b(what is|explain|understand|how.*use)\b/u.test(input) && /\b(ai os|capability dashboard|agent engine)\b/u.test(input);
}

function asksForStatus(input: string): boolean {
  return (
    /\b(ai|model|provider|ollama|gpu|cpu|ram|vram|hardware)\b/u.test(input) &&
    /\b(status|available|reachable|online|health|tokens|benchmark|capabilities)\b/u.test(input)
  );
}

function asksForLocalSummary(input: string): boolean {
  return /\b(summary|summarize|overview|what should i do|where should i start|todo|to-do|priorities)\b/u.test(input);
}

function memorySearchQuery(input: string): string {
  const match = input.match(/\b(?:search|query|look up|find)\s+(?:my\s+)?(?:semantic\s+)?(?:memory|rag)\s+(?:for|about)?\s*(.+)$/iu);
  return match?.[1]?.trim() ?? '';
}

function navigationDestination(input: string): { route: string; label: string } | null {
  if (!/\b(open|go to|show|take me to|navigate|switch to|view)\b/u.test(input)) return null;
  return appDestinations.find((destination) => destination.terms.some((term) => input.includes(term))) ?? null;
}

function looksLikeAppCommand(input: string): boolean {
  const actionVerb = /\b(add|create|generate|make|draw|render|save|export|log|record|update|edit|delete|remove|archive|mark|send|draft|reply|run|start|stop|focus|search)\b/u;
  const appNoun = /\b(study|session|career|job|application|macro|automation|gmail|email|calendar|event|deadline|memory|rag|hub|app|image|picture|photo|media|file|desktop|download)\b/u;
  return actionVerb.test(input) && appNoun.test(input);
}
