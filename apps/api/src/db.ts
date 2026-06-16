import * as schema from '@mini-hub/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env';

export function createDrizzleClient(databaseUrl = env.databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create the Postgres client.');
  }

  const client = postgres(databaseUrl, { prepare: false });
  return drizzle(client, { schema });
}

