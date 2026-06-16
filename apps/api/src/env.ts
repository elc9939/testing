const fallbackSecret = 'dev-only-change-me-32-characters-minimum';

function splitOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:1420,http://127.0.0.1:1420')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: process.env.DATABASE_URL,
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? fallbackSecret,
  trustedOrigins: splitOrigins(process.env.TRUSTED_ORIGINS),
  syncMode: process.env.PUBLIC_SYNC_MODE ?? process.env.SYNC_MODE ?? 'personal',
  personalSyncKey: process.env.MINI_HUB_SYNC_KEY,
  devAuthBypass: process.env.MINI_HUB_DEV_AUTH_BYPASS === 'true',
  tokenEncryptionKey: process.env.MINI_HUB_TOKEN_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET ?? fallbackSecret,
  hubPublicUrl: process.env.HUB_PUBLIC_URL ?? 'http://127.0.0.1:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? `http://127.0.0.1:${process.env.PORT ?? 8787}/api/integrations/google/oauth/callback`,
  brightspaceBaseUrl: process.env.BRIGHTSPACE_BASE_URL,
  brightspaceClientId: process.env.BRIGHTSPACE_CLIENT_ID,
  brightspaceClientSecret: process.env.BRIGHTSPACE_CLIENT_SECRET,
  brightspaceIcalUrl: process.env.BRIGHTSPACE_ICAL_URL
};
