import { describe, expect, it } from 'vitest';
import { assistantExplanation, resolveAssistantIntent } from './assistant';

describe('assistant intent resolver', () => {
  it('routes explicit navigation requests without using model calls', () => {
    expect(resolveAssistantIntent('open Career Desk')).toEqual({
      kind: 'navigate',
      route: '/desk/career',
      label: 'Career Desk'
    });
  });

  it('explains the lab and OS surfaces directly', () => {
    expect(resolveAssistantIntent('what is AI Lab?')).toEqual({ kind: 'explain', topic: 'ai-lab' });
    expect(resolveAssistantIntent('explain AI OS')).toEqual({ kind: 'explain', topic: 'ai-os' });
    expect(assistantExplanation('ai-os')).toContain('capability console');
  });

  it('recognizes status and semantic memory requests', () => {
    expect(resolveAssistantIntent('which ollama models are available?')).toEqual({ kind: 'status' });
    expect(resolveAssistantIntent('search memory for eigenvectors')).toEqual({
      kind: 'memory-search',
      query: 'eigenvectors'
    });
  });

  it('sends app-changing requests to AI OS command mode', () => {
    expect(resolveAssistantIntent('add a 25 minute study session for linear algebra')).toEqual({ kind: 'command' });
    expect(resolveAssistantIntent('tell me a joke')).toEqual({ kind: 'chat' });
  });

  it('sends web and browser access requests to AI OS command mode', () => {
    expect(resolveAssistantIntent('search the web for local llm benchmarks')).toEqual({ kind: 'command' });
    expect(resolveAssistantIntent('scrape https://example.com and extract the links')).toEqual({ kind: 'command' });
    expect(resolveAssistantIntent('open https://example.com in browser mode')).toEqual({ kind: 'command' });
  });
});
