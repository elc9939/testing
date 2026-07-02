import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fallbackSecret = 'dev-only-change-me-32-characters-minimum';

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([\w.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, value] = match;
    if (key && process.env[key] === undefined) process.env[key] = unquoteEnvValue(value ?? '');
  }
}

for (const path of new Set([
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '.env.local'),
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '../../.env.local')
])) {
  loadEnvFile(path);
}

function splitOrigins(value: string | undefined): string[] {
  return (
    value ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175,http://localhost:1420,http://127.0.0.1:1420,https://elc9939.github.io'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.MINI_HUB_DATA_DIR ?? resolve(process.cwd(), '../../.mini-hub-data'),
  databaseUrl: process.env.DATABASE_URL,
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? fallbackSecret,
  trustedOrigins: splitOrigins(process.env.TRUSTED_ORIGINS),
  syncMode: process.env.PUBLIC_SYNC_MODE ?? process.env.SYNC_MODE ?? 'personal',
  devAuthBypass: process.env.MINI_HUB_DEV_AUTH_BYPASS === 'true',
  tokenEncryptionKey: process.env.MINI_HUB_TOKEN_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET ?? fallbackSecret,
  bridgeToken: process.env.MINI_HUB_BRIDGE_TOKEN,
  hubPublicUrl: process.env.HUB_PUBLIC_URL ?? 'http://127.0.0.1:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? `http://127.0.0.1:${process.env.PORT ?? 8787}/api/integrations/google/oauth/callback`,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? 'llama3.1:8b',
  ollamaContextTokens: Number(process.env.OLLAMA_CONTEXT_TOKENS ?? 8192),
  ollamaAssistantTimeoutMs: Number(process.env.OLLAMA_ASSISTANT_TIMEOUT_MS ?? 45_000),
  ollamaEmailTriageTimeoutMs: Number(process.env.OLLAMA_EMAIL_TRIAGE_TIMEOUT_MS ?? 45_000),
  emailTriageAi: process.env.MINI_HUB_EMAIL_TRIAGE_AI !== 'false',
  aiOsApiUrl: process.env.AI_OS_API_URL ?? process.env.PUBLIC_AI_OS_API_URL ?? 'http://127.0.0.1:8791',
  macroLabApiUrl: process.env.MACRO_LAB_API_URL ?? process.env.PUBLIC_MACRO_LAB_API_URL ?? 'http://127.0.0.1:8792',
  actionLedgerFederationTimeoutMs: Number(process.env.MINI_HUB_ACTION_LEDGER_TIMEOUT_MS ?? 2500),
  brightspaceBaseUrl: process.env.BRIGHTSPACE_BASE_URL,
  brightspaceClientId: process.env.BRIGHTSPACE_CLIENT_ID,
  brightspaceClientSecret: process.env.BRIGHTSPACE_CLIENT_SECRET,
  brightspaceIcalUrl: process.env.BRIGHTSPACE_ICAL_URL
};
