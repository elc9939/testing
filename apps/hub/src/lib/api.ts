export const apiUrl = import.meta.env.PUBLIC_API_URL || 'http://127.0.0.1:8787';

export async function getHealth(): Promise<{ ok: boolean; service: string }> {
  const response = await fetch(`${apiUrl}/api/health`, { credentials: 'include' });
  if (!response.ok) throw new Error(`API health failed with ${response.status}`);
  return (await response.json()) as { ok: boolean; service: string };
}
