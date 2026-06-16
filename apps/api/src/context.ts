import type { Context } from 'hono';

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
}

export interface AppBindings {
  Variables: {
    user: SessionUser | null;
    session: { id: string; userId: string } | null;
    syncKeyAccepted: boolean;
  };
}

export function requireUser(c: Context<AppBindings>): SessionUser | Response {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return user;
}
