import { PGlite } from '@electric-sql/pglite';

export const localSchemaSql = `
create table if not exists jobs (
  id text primary key,
  workspace_id text not null,
  company text not null,
  role text not null,
  status text not null default 'lead',
  fit_score integer,
  next_action_at text,
  notes text not null default '',
  device_id text not null,
  deleted boolean not null default false,
  updated_at text not null
);

create table if not exists study_sessions (
  id text primary key,
  workspace_id text not null,
  subject text not null,
  minutes integer not null,
  source text not null default 'manual',
  logged_at text not null,
  device_id text not null,
  deleted boolean not null default false,
  updated_at text not null
);

create table if not exists game_runs (
  id text primary key,
  workspace_id text not null,
  game_id text not null,
  score integer not null default 0,
  duration_ms integer not null default 0,
  metadata text not null default '{}',
  device_id text not null,
  updated_at text not null
);

create table if not exists personal_settings (
  workspace_id text primary key,
  theme text,
  high_scores text not null default '{}',
  recent_state text not null default '{}',
  preferences text not null default '{}',
  last_legacy_import_at text,
  device_id text not null,
  updated_at text not null
);

create table if not exists game_state (
  id text primary key,
  workspace_id text not null,
  game_id text not null,
  state text not null default '{}',
  device_id text not null,
  updated_at text not null
);

create table if not exists achievements (
  id text primary key,
  workspace_id text not null,
  code text not null,
  title text not null,
  unlocked_at text not null,
  device_id text not null,
  updated_at text not null
);

create table if not exists notes (
  id text primary key,
  workspace_id text not null,
  entity_type text not null,
  entity_id text not null,
  body text not null default '',
  device_id text not null,
  updated_at text not null
);

create table if not exists sync_events (
  id text primary key,
  workspace_id text not null,
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  payload text not null default '{}',
  device_id text not null,
  created_at text not null
);

create table if not exists sync_meta (
  key text primary key,
  value text not null
);
`;

export interface LocalDatabaseOptions {
  dataDir?: string;
}

export async function createMiniHubPglite(options: LocalDatabaseOptions = {}): Promise<PGlite> {
  const db = new PGlite(options.dataDir ?? 'idb://mini-hub');
  await db.exec(localSchemaSql);
  return db;
}
