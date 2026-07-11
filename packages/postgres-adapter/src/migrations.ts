import { createHash } from 'node:crypto';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationInput {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export function migrationChecksum(input: MigrationInput): string {
  return createHash('sha256')
    .update(`${String(input.version)}\n${input.name}\n${input.sql}`, 'utf8')
    .digest('hex');
}

export function defineMigration(input: MigrationInput): Migration {
  return Object.freeze({ ...input, checksum: migrationChecksum(input) });
}

export const foundationMigrations: readonly Migration[] = Object.freeze([
  defineMigration({
    version: 1,
    name: 'adapter_foundation',
    sql: `
create table mammoth_adapter_metadata (
  singleton boolean primary key default true check (singleton),
  contract_major integer not null check (contract_major > 0),
  created_at timestamptz not null default clock_timestamp()
);
insert into mammoth_adapter_metadata (singleton, contract_major)
values (true, 1);
`.trim(),
  }),
  defineMigration({
    version: 2,
    name: 'transactional_epistemic_ledger',
    sql: `
create table mammoth_epistemic_ledger (
  singleton boolean primary key default true check (singleton),
  revision bigint not null check (revision >= 0),
  state jsonb not null,
  updated_at timestamptz not null
);
insert into mammoth_epistemic_ledger (singleton, revision, state, updated_at)
values (true, 0, '{"schemaVersion":1,"revision":0,"claims":[],"assessments":[],"evidence":[],"claimEvidenceEdges":[],"claimDependencies":[],"sourceLineages":[]}'::jsonb, clock_timestamp());

create table mammoth_epistemic_revisions (
  revision bigint primary key check (revision > 0),
  state jsonb not null,
  committed_at timestamptz not null
);

create table mammoth_audit_log (
  id text primary key,
  ledger_revision bigint not null unique references mammoth_epistemic_revisions(revision),
  event_type text not null,
  payload jsonb not null,
  recorded_at timestamptz not null
);

create table mammoth_outbox (
  id text primary key,
  ledger_revision bigint not null unique references mammoth_epistemic_revisions(revision),
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  published_at timestamptz
);
create index mammoth_outbox_unpublished_idx
  on mammoth_outbox (created_at, id) where published_at is null;
`.trim(),
  }),
]);
