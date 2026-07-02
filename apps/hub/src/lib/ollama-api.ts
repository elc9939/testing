import { env as publicEnv } from '$env/dynamic/public';
import { requestServiceJson, resolveServiceUrl } from './service-config';

export function getOllamaUrl(): string {
  return resolveServiceUrl(
    'ollama',
    publicEnv.PUBLIC_OLLAMA_URL || import.meta.env.VITE_PUBLIC_OLLAMA_URL,
    'http://127.0.0.1:11434'
  );
}

export interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string; modified_at?: string; size?: number }>;
}

export async function getOllamaTags(): Promise<OllamaTagsResponse> {
  return requestServiceJson<OllamaTagsResponse>('ollama', getOllamaUrl(), '/api/tags', {}, { timeoutMs: 5_000 });
}
