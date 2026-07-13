-- Reference schema for the Postgres adapter. Local MVP tests use LocalJsonLedger.
create table if not exists source_lineages (
  id text primary key,
  canonical_origin_id text references source_lineages(id),
  lineage_type text not null,
  independence_score double precision not null check (independence_score between 0 and 1),
  notes jsonb
);

create table if not exists source_lineage_edges (
  lineage_id text not null references source_lineages(id),
  parent_lineage_id text not null references source_lineages(id),
  primary key (lineage_id, parent_lineage_id),
  check (lineage_id <> parent_lineage_id)
);

create table if not exists claim_dependencies (
  id text primary key,
  claim_id text not null references claims(id),
  depends_on_claim_id text not null references claims(id),
  kind text not null,
  rationale text,
  unique (claim_id, depends_on_claim_id, kind),
  check (claim_id <> depends_on_claim_id)
);

create index if not exists claim_dependencies_claim_idx
  on claim_dependencies (claim_id);
create index if not exists claim_dependencies_parent_idx
  on claim_dependencies (depends_on_claim_id);

-- Migration 6: P5 isolated-divergence authority and budget lifecycle.
create table if not exists p5_cell_attempts (
  id text primary key,
  cell_plan_id text not null,
  work_item_id text not null,
  program_id text not null,
  attempt integer not null check (attempt > 0),
  owner_id text not null,
  fencing_token bigint not null check (fencing_token > 0),
  state text not null check (state in (
    'started',
    'committed',
    'revealed',
    'settling',
    'completed',
    'failed',
    'cancelled'
  )),
  partial_result_digest text check (partial_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  partial_result jsonb,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  unique (cell_plan_id, attempt),
  unique (cell_plan_id, fencing_token)
);

create table if not exists p5_isolation_commits (
  id text primary key,
  position_id text not null unique,
  cell_plan_id text not null,
  program_id text not null,
  work_item_id text not null,
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_digest text not null check (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  position_digest text not null check (position_digest ~ '^sha256:[0-9a-f]{64}$'),
  isolation_protocol_version text not null check (isolation_protocol_version = '1.0.0'),
  audit_sequence bigint not null check (audit_sequence >= 0),
  committed_at timestamptz not null,
  check (output_digest = position_digest)
);

create table if not exists p5_isolation_reveals (
  id text primary key,
  position_id text not null references p5_isolation_commits(position_id),
  cell_plan_id text not null,
  program_id text not null,
  reveal_digest text not null check (reveal_digest ~ '^sha256:[0-9a-f]{64}$'),
  revealed_to_position_ids jsonb not null,
  audit_sequence bigint not null check (audit_sequence >= 0),
  revealed_at timestamptz not null
);

create table if not exists p5_sanitized_review_contexts (
  id text primary key,
  assignment_id text not null unique,
  target_position_id text not null,
  program_id text not null,
  contract_version text not null check (contract_version = '1.0.0'),
  context_digest text not null check (context_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null
);

create table if not exists p5_budget_reservations (
  id text primary key,
  stable_identity text not null unique,
  program_id text not null,
  work_item_id text not null,
  attempt_id text not null references p5_cell_attempts(id),
  ceiling jsonb not null,
  state text not null check (state in ('reserved', 'settled', 'released', 'cancelled')),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists p5_budget_settlements (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references p5_budget_reservations(id),
  amount jsonb not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  settled_at timestamptz not null
);

create table if not exists p5_budget_releases (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references p5_budget_reservations(id),
  reason text not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  released_at timestamptz not null
);

create table if not exists p5_provider_charges (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references p5_budget_reservations(id),
  provider text not null,
  provider_receipt_id text not null,
  amount jsonb not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  charged_at timestamptz not null,
  unique (provider, provider_receipt_id)
);

create table if not exists p5_cancellation_receipts (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text references p5_budget_reservations(id),
  attempt_id text not null references p5_cell_attempts(id),
  program_id text not null,
  work_item_id text not null,
  cancellation_phase text not null check (cancellation_phase in (
    'before_dispatch',
    'during_generation',
    'after_commit_before_reveal',
    'during_review',
    'during_settlement'
  )),
  consumed jsonb not null,
  released jsonb not null,
  partial_result_digest text check (partial_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  partial_result jsonb,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  cancelled_at timestamptz not null
);

create index if not exists p5_cell_attempts_program_idx
  on p5_cell_attempts (program_id, cell_plan_id, state);
create index if not exists p5_isolation_commits_program_idx
  on p5_isolation_commits (program_id, cell_plan_id, audit_sequence);
create index if not exists p5_isolation_reveals_program_idx
  on p5_isolation_reveals (program_id, cell_plan_id, audit_sequence);
create index if not exists p5_budget_reservations_program_idx
  on p5_budget_reservations (program_id, work_item_id, state);
create index if not exists p5_cancellation_receipts_program_idx
  on p5_cancellation_receipts (program_id, work_item_id, cancellation_phase);
