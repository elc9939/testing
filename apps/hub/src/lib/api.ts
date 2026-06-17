import { env as publicEnv } from '$env/dynamic/public';

export const apiUrl = publicEnv.PUBLIC_API_URL || import.meta.env.VITE_PUBLIC_API_URL || 'http://127.0.0.1:8787';

function jsonHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    accept: 'application/json'
  };
}

function messageFromJson(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const error = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
  return typeof error === 'string' ? error.trim() : '';
}

function apiBaseHint(path: string): string {
  return `API request ${path} returned the web app HTML instead of JSON. Start the API or set PUBLIC_API_URL to the API origin (${apiUrl}).`;
}

export async function requestApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...jsonHeaders(),
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network request failed';
    throw new Error(`API unavailable at ${apiUrl}: ${detail}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  let body: unknown = undefined;

  if (text.trim()) {
    if (!contentType.includes('application/json') && !contentType.includes('+json')) {
      if (text.trimStart().startsWith('<')) {
        throw new Error(apiBaseHint(path));
      }
      throw new Error(`API request ${path} returned ${contentType || 'non-JSON'} instead of JSON.`);
    }

    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`API request ${path} returned invalid JSON.`);
    }
  }

  if (!response.ok) {
    throw new Error(messageFromJson(body) || `Request ${path} failed with ${response.status}`);
  }

  return body as T;
}

export async function getHealth(): Promise<{ ok: boolean; service: string }> {
  return requestApiJson<{ ok: boolean; service: string }>('/api/health');
}
