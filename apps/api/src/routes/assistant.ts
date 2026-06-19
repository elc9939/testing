import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import { requireUser, type AppBindings } from '../context';

const chatBody = z.object({
  message: z.string().min(1).max(20_000),
  context: z.record(z.string(), z.unknown()).default({})
});

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown }>;
}

interface OllamaGenerateResponse {
  response?: unknown;
}

let ollamaModelPromise: Promise<string | null> | null = null;

async function resolveOllamaModel(): Promise<string | null> {
  if (ollamaModelPromise) return ollamaModelPromise;
  ollamaModelPromise = (async () => {
    const configuredModel = env.ollamaChatModel.trim();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${env.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) return configuredModel || null;
      const body = (await response.json()) as OllamaTagsResponse;
      const models = (body.models ?? [])
        .map((model) => (typeof model.name === 'string' ? model.name : typeof model.model === 'string' ? model.model : ''))
        .filter(Boolean);
      if (!models.length) return configuredModel || null;
      return models.includes(configuredModel) ? configuredModel : (models[0] ?? configuredModel);
    } catch {
      return configuredModel || null;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return ollamaModelPromise;
}

function systemPrompt(message: string, context: Record<string, unknown>): string {
  const contextText = Object.keys(context).length ? `\n\nApp context JSON:\n${JSON.stringify(context).slice(0, 3000)}` : '';
  return [
    'You are the Mini Hub side assistant for a private, single-user productivity and AI app.',
    'Be concise, practical, and plainspoken.',
    'You can explain the app, suggest where to click, summarize supplied local hub context, and help the user reason through tasks.',
    'Do not claim that you changed app state, sent email, edited calendar events, ran macros, or controlled the computer unless a tool result is explicitly provided.',
    contextText,
    `User: ${message}`
  ]
    .filter(Boolean)
    .join('\n');
}

async function runOllamaChat(message: string, context: Record<string, unknown>): Promise<{ text: string; model: string }> {
  const model = await resolveOllamaModel();
  if (!model) throw new Error('No Ollama chat model is configured.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ollamaAssistantTimeoutMs);
  try {
    const response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          num_ctx: env.ollamaContextTokens
        },
        prompt: systemPrompt(message, context)
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Ollama chat failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
    }
    const body = (await response.json()) as OllamaGenerateResponse;
    const text = typeof body.response === 'string' ? body.response.trim() : '';
    if (!text) throw new Error('Ollama returned an empty assistant response.');
    return { text, model };
  } finally {
    clearTimeout(timeout);
  }
}

export function assistantRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/chat', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const parsed = chatBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);

    try {
      const result = await runOllamaChat(parsed.data.message, parsed.data.context);
      return c.json({
        text: result.text,
        provider: 'ollama',
        model: result.model,
        fallback: 'mini-hub-api'
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : 'Assistant model request failed',
          provider: 'ollama',
          fallback: 'mini-hub-api'
        },
        503
      );
    }
  });

  return app;
}
