import { requestApiJson } from './api';

export interface AssistantChatResponse {
  text: string;
  provider: string;
  model?: string;
  fallback?: string;
}

export async function chatWithMiniHubAssistant(input: {
  message: string;
  context?: Record<string, unknown>;
}): Promise<AssistantChatResponse> {
  return requestApiJson<AssistantChatResponse>('/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: input.message,
      context: input.context ?? {}
    })
  });
}
