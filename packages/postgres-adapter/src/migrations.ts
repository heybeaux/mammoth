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
  defineMigration({
    version: 3,
    name: 'durable_work_effects_outbox',
    sql: `
create table mammoth_work_items (
  id text primary key,
  authoritative_revision bigint references mammoth_epistemic_revisions(revision),
  status text not null check (status in ('pending','leased','retry_wait','completed','failed','cancelled')),
  payload jsonb not null,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null check (max_attempts > 0),
  next_attempt_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  cancellation_requested_at timestamptz,
  terminal_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((status = 'leased') = (lease_owner is not null and lease_expires_at is not null))
);
create index mammoth_work_claimable_idx
  on mammoth_work_items (next_attempt_at, id)
  where status in ('pending','retry_wait');

create table mammoth_effect_receipts (
  id text primary key,
  work_id text not null references mammoth_work_items(id),
  provider text not null,
  idempotency_key text not null,
  fencing_token bigint not null check (fencing_token > 0),
  state text not null check (state in ('partial','completed')),
  provider_receipt jsonb not null,
  recorded_at timestamptz not null,
  unique (provider, idempotency_key, state),
  unique (work_id, fencing_token, state)
);

create table mammoth_work_outbox (
  id text primary key,
  work_id text not null references mammoth_work_items(id),
  authoritative_revision bigint references mammoth_epistemic_revisions(revision),
  fencing_token bigint not null check (fencing_token >= 0),
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  poison_at timestamptz
);
create index mammoth_work_outbox_available_idx
  on mammoth_work_outbox (available_at, id) where poison_at is null;

create table mammoth_outbox_dispatches (
  outbox_id text not null references mammoth_work_outbox(id),
  destination text not null,
  dispatch_key text not null,
  provider_receipt jsonb not null,
  dispatched_at timestamptz not null,
  primary key (outbox_id, destination),
  unique (destination, dispatch_key)
);
`.trim(),
  }),
  defineMigration({
    version: 4,
    name: 'activity_effect_v2',
    sql: `
create table mammoth_activity_work (
  work_id text primary key references mammoth_work_items(id),
  program_id text not null,
  activity_type text not null,
  contract_version text not null,
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null,
  unique (program_id, work_id, activity_type, contract_version, input_digest)
);

create table mammoth_activity_effects (
  id text primary key,
  provider text not null,
  idempotency_key text not null check (idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  program_id text not null,
  work_id text not null references mammoth_activity_work(work_id),
  operation_kind text not null,
  contract_version text not null,
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('started','ambiguous','completed')),
  original_attribution jsonb not null,
  provider_receipt jsonb,
  result_schema text,
  result_digest text check (result_digest is null or result_digest ~ '^sha256:[0-9a-f]{64}$'),
  result jsonb,
  started_at timestamptz not null,
  ambiguous_at timestamptz,
  completed_at timestamptz,
  check ((state = 'completed') = (provider_receipt is not null and result_schema is not null
    and result_digest is not null and result is not null and completed_at is not null)),
  unique (provider, idempotency_key)
);
create index mammoth_activity_effect_completed_idx
  on mammoth_activity_effects (provider, idempotency_key) where state = 'completed';
create index mammoth_activity_effect_ambiguous_idx
  on mammoth_activity_effects (ambiguous_at, id) where state = 'ambiguous';
create index mammoth_activity_effect_work_idx
  on mammoth_activity_effects (work_id, operation_kind);

create table mammoth_activity_attempts (
  id text primary key,
  work_id text not null references mammoth_activity_work(work_id),
  provider text,
  idempotency_key text not null,
  workflow_id text not null,
  run_id text not null,
  activity_id text not null,
  activity_attempt integer not null check (activity_attempt > 0),
  task_queue text not null,
  worker_id text,
  lease_owner text,
  fencing_token bigint check (fencing_token is null or fencing_token > 0),
  heartbeat_progress jsonb,
  outcome text,
  failure_code text,
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  unique (workflow_id, run_id, activity_id, activity_attempt)
);
create index mammoth_activity_attempt_work_idx on mammoth_activity_attempts (work_id, recorded_at);
create index mammoth_activity_attempt_workflow_idx on mammoth_activity_attempts (workflow_id, run_id);
create index mammoth_activity_attempt_failure_idx
  on mammoth_activity_attempts (failure_code, updated_at) where failure_code is not null;

create function mammoth_guard_activity_effect_completion() returns trigger language plpgsql as $$
begin
  if old.state = 'completed' and new is distinct from old then
    raise exception 'completed Activity effects are immutable';
  end if;
  if old.provider is distinct from new.provider
     or old.idempotency_key is distinct from new.idempotency_key
     or old.program_id is distinct from new.program_id
     or old.work_id is distinct from new.work_id
     or old.operation_kind is distinct from new.operation_kind
     or old.contract_version is distinct from new.contract_version
     or old.input_digest is distinct from new.input_digest then
    raise exception 'Activity effect identity is immutable';
  end if;
  if old.state = 'ambiguous' and new.state = 'started' then
    raise exception 'Activity effect lifecycle cannot move backwards';
  end if;
  return new;
end;
$$;
create trigger mammoth_activity_effect_completion_guard
  before update on mammoth_activity_effects
  for each row execute function mammoth_guard_activity_effect_completion();
`.trim(),
  }),
]);
