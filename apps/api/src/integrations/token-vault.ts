import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IntegrationConnection } from '@mini-hub/core';
import { integrationConnectionSchema, personalWorkspaceId } from '@mini-hub/core';
import { env } from '../env';
import { persistIntegrationConnections, type MemoryStore } from '../store';

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
}

export interface OAuthState {
  provider: 'google';
  workspaceId: string;
  nonce: string;
  expiresAt: string;
  returnTo?: string;
}

const algorithm = 'aes-256-gcm';

function key(): Buffer {
  return createHash('sha256').update(env.tokenEncryptionKey).digest();
}

export function encryptTokenSet(tokenSet: OAuthTokenSet): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokenSet), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptTokenSet(value: string): OAuthTokenSet {
  const [ivPart, tagPart, ciphertextPart] = value.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Invalid encrypted token payload');
  const decipher = createDecipheriv(algorithm, key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext) as OAuthTokenSet;
}

function signStatePayload(payload: string): string {
  return createHmac('sha256', env.tokenEncryptionKey).update(payload).digest('base64url');
}

export function createOAuthState(
  provider: OAuthState['provider'],
  workspaceId = personalWorkspaceId,
  options: { returnTo?: string | undefined } = {}
): string {
  const state: OAuthState = {
    provider,
    workspaceId,
    nonce: randomBytes(16).toString('base64url'),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  };
  if (options.returnTo) state.returnTo = options.returnTo;
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = signStatePayload(payload);
  return `${payload}.${signature}`;
}

export function verifyOAuthState(value: string, provider: OAuthState['provider']): OAuthState {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) throw new Error('Invalid OAuth state');
  const expected = signStatePayload(payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('Invalid OAuth state signature');
  }
  const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
  if (state.provider !== provider) throw new Error('OAuth state provider mismatch');
  if (Date.parse(state.expiresAt) < Date.now()) throw new Error('OAuth state expired');
  return state;
}

export function upsertConnection(
  store: MemoryStore,
  input: Omit<IntegrationConnection, 'id' | 'createdAt' | 'updatedAt'>
): IntegrationConnection {
  const now = new Date().toISOString();
  const existing = Array.from(store.integrationConnections.values()).find(
    (connection) =>
      connection.workspaceId === input.workspaceId &&
      connection.provider === input.provider &&
      connection.accountLabel === input.accountLabel
  );
  const connection = integrationConnectionSchema.parse({
    ...(existing ?? {}),
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
  store.integrationConnections.set(connection.id, connection);
  persistIntegrationConnections(store);
  return connection;
}

export function getConnection(store: MemoryStore, provider: IntegrationConnection['provider']): IntegrationConnection | null {
  return (
    Array.from(store.integrationConnections.values()).find(
      (connection) => connection.workspaceId === personalWorkspaceId && connection.provider === provider
    ) ?? null
  );
}

export function getConnectionById(store: MemoryStore, id: string): IntegrationConnection | null {
  return store.integrationConnections.get(id) ?? null;
}

export function getConnections(store: MemoryStore, provider: IntegrationConnection['provider']): IntegrationConnection[] {
  return Array.from(store.integrationConnections.values()).filter(
    (connection) => connection.workspaceId === personalWorkspaceId && connection.provider === provider
  );
}
