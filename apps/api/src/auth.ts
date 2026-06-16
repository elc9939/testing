import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { env } from './env';

const pool = env.databaseUrl ? new Pool({ connectionString: env.databaseUrl }) : undefined;

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: pool,
  trustedOrigins: env.trustedOrigins,
  emailAndPassword: {
    enabled: Boolean(pool)
  }
});

