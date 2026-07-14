import { createHash } from 'node:crypto';
import {
  P4_ADMISSION_POLICY_DIGEST,
  P4_ADMISSION_POLICY_VERSION,
} from '@mammoth/persistence';

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
  defineMigration({
    version: 5,
    name: 'research_cell_persistence',
    sql: `
create table mammoth_model_profiles (
  id text primary key,
  provider text not null,
  canonical_name text not null,
  family_id text not null,
  active boolean not null,
  authoritative_contract jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (provider, canonical_name)
);

create table mammoth_model_profile_aliases (
  profile_id text not null references mammoth_model_profiles(id),
  provider text not null,
  alias text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (profile_id, provider, alias),
  unique (provider, alias),
  check (last_seen_at >= first_seen_at)
);

create table mammoth_model_profile_versions (
  id text primary key,
  profile_id text not null references mammoth_model_profiles(id),
  profile_revision bigint not null check (profile_revision > 0),
  provider text not null,
  model_name text not null,
  checkpoint text not null,
  family_id text not null,
  lineage_status text not null check (lineage_status in ('known','partial','unknown')),
  training_lineage_ids jsonb not null,
  fine_tune_lineage_ids jsonb not null,
  shared_derivation_ids jsonb not null,
  locality text not null check (locality in ('local','cloud','unknown')),
  modalities jsonb not null,
  context_window integer not null check (context_window >= 0),
  data_policy_id text not null,
  cost_profile_id text not null,
  declared_at timestamptz not null,
  metadata jsonb not null,
  authoritative_contract jsonb not null,
  unique (profile_id, profile_revision),
  unique (profile_id, provider, model_name, checkpoint)
);
create index mammoth_model_profile_versions_family_idx
  on mammoth_model_profile_versions (family_id, checkpoint);

create table mammoth_model_lineage_edges (
  child_version_id text not null references mammoth_model_profile_versions(id),
  parent_version_id text not null references mammoth_model_profile_versions(id),
  edge_kind text not null check (edge_kind in ('parent','alias')),
  created_at timestamptz not null,
  primary key (child_version_id, parent_version_id, edge_kind),
  check (child_version_id <> parent_version_id)
);
create unique index mammoth_model_lineage_alias_unique_idx
  on mammoth_model_lineage_edges (child_version_id) where edge_kind = 'alias';
create index mammoth_model_lineage_parent_idx
  on mammoth_model_lineage_edges (parent_version_id, child_version_id);

create table mammoth_cell_plans (
  id text primary key,
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_version text not null,
  template_version text not null,
  branch_id text not null,
  role text not null,
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_contract_version text not null,
  status text not null check (status in ('planned','leased','completed','failed','cancelled')),
  revision bigint not null default 0 check (revision >= 0),
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  terminal_reason text,
  authoritative_contract jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (program_id, criterion_id, criterion_digest, plan_version, branch_id, role),
  unique (program_id, work_item_id)
);
create index mammoth_cell_plans_program_idx on mammoth_cell_plans (program_id, status, id);
create index mammoth_cell_plans_criterion_idx on mammoth_cell_plans (criterion_id, criterion_digest);

create table mammoth_research_positions (
  id text primary key,
  cell_plan_id text not null references mammoth_cell_plans(id),
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  model_profile_id text not null references mammoth_model_profiles(id),
  model_profile_version_id text not null references mammoth_model_profile_versions(id),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_schema_version text not null,
  position_digest text not null check (position_digest ~ '^sha256:[0-9a-f]{64}$'),
  claim_ids jsonb not null,
  evidence_ids jsonb not null,
  hypothesis_ids jsonb not null,
  proposal_refs jsonb not null,
  usage jsonb not null,
  uncertainty_codes jsonb not null,
  failure_codes jsonb not null,
  body jsonb not null,
  admission_decision text not null check (admission_decision = 'admitted'),
  admission_policy_version text not null check (admission_policy_version = '${P4_ADMISSION_POLICY_VERSION}'),
  admission_policy_digest text not null check (admission_policy_digest = '${P4_ADMISSION_POLICY_DIGEST}'),
  admission_subject_digest text not null check (admission_subject_digest = position_digest),
  admission_reason_codes jsonb not null check (
    jsonb_typeof(admission_reason_codes) = 'array' and jsonb_array_length(admission_reason_codes) > 0
  ),
  admission_decided_at timestamptz not null,
  authoritative_contract jsonb not null,
  recorded_at timestamptz not null,
  unique (cell_plan_id, work_item_id, model_profile_version_id, position_digest)
);
create index mammoth_research_positions_program_idx on mammoth_research_positions (program_id, cell_plan_id);
create index mammoth_research_positions_model_idx on mammoth_research_positions (model_profile_version_id);

create table mammoth_review_assignments (
  id text primary key,
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  target_position_id text not null references mammoth_research_positions(id),
  reviewer_agent_id text not null,
  reviewer_model_profile_version_id text not null references mammoth_model_profile_versions(id),
  reviewer_role text not null,
  target_author_agent_id text not null,
  target_model_profile_version_id text not null references mammoth_model_profile_versions(id),
  target_role text not null,
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  blind boolean not null,
  assignment_digest text not null check (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  authoritative_contract jsonb not null,
  recorded_at timestamptz not null,
  unique (target_position_id, reviewer_model_profile_version_id, reviewer_role)
);
create index mammoth_review_assignments_program_idx
  on mammoth_review_assignments (program_id, target_position_id);

create table mammoth_research_reviews (
  id text primary key,
  assignment_id text not null references mammoth_review_assignments(id),
  position_id text not null references mammoth_research_positions(id),
  cell_plan_id text not null references mammoth_cell_plans(id),
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  model_profile_id text not null references mammoth_model_profiles(id),
  model_profile_version_id text not null references mammoth_model_profile_versions(id),
  reviewer_role text not null,
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_schema_version text not null,
  review_digest text not null check (review_digest ~ '^sha256:[0-9a-f]{64}$'),
  verdict text not null check (verdict in ('admit','reject','revise','unresolved')),
  claim_ids jsonb not null,
  evidence_ids jsonb not null,
  hypothesis_ids jsonb not null,
  usage jsonb not null,
  uncertainty_codes jsonb not null,
  failure_codes jsonb not null,
  reasons jsonb not null,
  body jsonb not null,
  admission_decision text not null check (admission_decision = 'admitted'),
  admission_policy_version text not null check (admission_policy_version = '${P4_ADMISSION_POLICY_VERSION}'),
  admission_policy_digest text not null check (admission_policy_digest = '${P4_ADMISSION_POLICY_DIGEST}'),
  admission_subject_digest text not null check (admission_subject_digest = review_digest),
  admission_reason_codes jsonb not null check (
    jsonb_typeof(admission_reason_codes) = 'array' and jsonb_array_length(admission_reason_codes) > 0
  ),
  admission_decided_at timestamptz not null,
  authoritative_contract jsonb not null,
  recorded_at timestamptz not null,
  unique (position_id, reviewer_role, model_profile_version_id)
);
create index mammoth_research_reviews_program_idx on mammoth_research_reviews (program_id, position_id);
create index mammoth_research_reviews_model_idx on mammoth_research_reviews (model_profile_version_id);

create table mammoth_dissent_reports (
  id text primary key,
  cell_plan_id text not null references mammoth_cell_plans(id),
  program_id text not null,
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  author_model_profile_version_id text not null references mammoth_model_profile_versions(id),
  report_digest text not null check (report_digest ~ '^sha256:[0-9a-f]{64}$'),
  claim_ids jsonb not null,
  evidence_ids jsonb not null,
  minority_position_ids jsonb not null,
  body jsonb not null,
  authoritative_contract jsonb not null,
  recorded_at timestamptz not null,
  unique (cell_plan_id, author_model_profile_version_id, report_digest)
);
create index mammoth_dissent_reports_program_idx on mammoth_dissent_reports (program_id, cell_plan_id);

create table mammoth_correlation_assessments (
  id text primary key,
  left_model_profile_version_id text not null references mammoth_model_profile_versions(id),
  right_model_profile_version_id text not null references mammoth_model_profile_versions(id),
  policy_version text not null,
  correlation_score numeric not null check (correlation_score >= 0 and correlation_score <= 1),
  independence_verdict text not null check (independence_verdict in ('independent','correlated','unknown')),
  reasons jsonb not null,
  assessment_digest text not null check (assessment_digest ~ '^sha256:[0-9a-f]{64}$'),
  authoritative_contract jsonb not null,
  assessed_at timestamptz not null,
  check (left_model_profile_version_id <> right_model_profile_version_id),
  unique (left_model_profile_version_id, right_model_profile_version_id, policy_version)
);
create index mammoth_correlation_assessments_right_idx
  on mammoth_correlation_assessments (right_model_profile_version_id, policy_version);

create table mammoth_rejected_audit_residue (
  id text primary key,
  program_id text not null,
  subject_type text not null check (subject_type in ('model-profile-version','cell-plan','position','review','dissent','correlation','receipt')),
  subject_id text not null,
  reason_code text not null,
  policy_version text not null,
  policy_digest text not null check (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  reason_codes jsonb not null check (
    jsonb_typeof(reason_codes) = 'array' and jsonb_array_length(reason_codes) > 0
  ),
  decision text not null check (decision = 'rejected'),
  payload_digest text not null check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  recorded_at timestamptz not null,
  unique (program_id, subject_type, subject_id, policy_version, reason_code)
);
create index mammoth_rejected_audit_residue_program_idx
  on mammoth_rejected_audit_residue (program_id, recorded_at, id);

create table mammoth_cell_receipts (
  id text primary key,
  program_id text not null,
  subject_type text not null,
  subject_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  receipt_kind text not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null,
  unique (program_id, subject_type, subject_id, receipt_kind)
);
create index mammoth_cell_receipts_program_idx on mammoth_cell_receipts (program_id, created_at, id);

create function mammoth_reject_immutable_update() returns trigger language plpgsql as $$
begin
  raise exception 'immutable research-cell row cannot be changed';
end;
$$;

create trigger mammoth_model_profile_versions_immutable
  before update or delete on mammoth_model_profile_versions
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_model_lineage_edges_immutable
  before update or delete on mammoth_model_lineage_edges
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_research_positions_immutable
  before update or delete on mammoth_research_positions
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_review_assignments_immutable
  before update or delete on mammoth_review_assignments
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_research_reviews_immutable
  before update or delete on mammoth_research_reviews
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_dissent_reports_immutable
  before update or delete on mammoth_dissent_reports
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_correlation_assessments_immutable
  before update or delete on mammoth_correlation_assessments
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_rejected_audit_residue_immutable
  before update or delete on mammoth_rejected_audit_residue
  for each row execute function mammoth_reject_immutable_update();
create trigger mammoth_cell_receipts_immutable
  before update or delete on mammoth_cell_receipts
  for each row execute function mammoth_reject_immutable_update();

create function mammoth_guard_research_position_model() returns trigger language plpgsql as $$
declare
  version_profile text;
begin
  select profile_id into version_profile
    from mammoth_model_profile_versions where id = new.model_profile_version_id;
  if version_profile is null or version_profile <> new.model_profile_id then
    raise exception 'position model profile/version mismatch';
  end if;
  return new;
end;
$$;
create trigger mammoth_research_position_model
  before insert on mammoth_research_positions
  for each row execute function mammoth_guard_research_position_model();

create function mammoth_guard_research_position_plan() returns trigger language plpgsql as $$
declare
  plan_program text;
  plan_work text;
  plan_criterion text;
  plan_criterion_digest text;
  plan_input_digest text;
begin
  select program_id, work_item_id, criterion_id, criterion_digest, input_digest
    into plan_program, plan_work, plan_criterion, plan_criterion_digest, plan_input_digest
    from mammoth_cell_plans where id = new.cell_plan_id;
  if plan_program is null
     or plan_program <> new.program_id
     or plan_work <> new.work_item_id
     or plan_criterion <> new.criterion_id
     or plan_criterion_digest <> new.criterion_digest
     or plan_input_digest <> new.input_digest then
    raise exception 'position cell-plan metadata mismatch';
  end if;
  return new;
end;
$$;
create trigger mammoth_research_position_plan
  before insert on mammoth_research_positions
  for each row execute function mammoth_guard_research_position_plan();

create function mammoth_guard_review_assignment_target() returns trigger language plpgsql as $$
declare
  target_program text;
  target_criterion text;
  target_criterion_digest text;
  target_author text;
  target_version text;
  target_role_value text;
begin
  select program_id, criterion_id, criterion_digest,
         authoritative_contract->>'authorAgentId', model_profile_version_id,
         authoritative_contract->>'role'
    into target_program, target_criterion, target_criterion_digest,
         target_author, target_version, target_role_value
    from mammoth_research_positions where id = new.target_position_id;
  if target_program is null
     or target_author is null
     or target_role_value is null
     or target_program <> new.program_id
     or target_criterion <> new.criterion_id
     or target_criterion_digest <> new.criterion_digest
     or target_author <> new.target_author_agent_id
     or target_version <> new.target_model_profile_version_id
     or target_role_value <> new.target_role
     or target_author = new.reviewer_agent_id
     or target_version = new.reviewer_model_profile_version_id then
    raise exception 'review assignment target metadata mismatch';
  end if;
  return new;
end;
$$;
create trigger mammoth_review_assignment_target
  before insert on mammoth_review_assignments
  for each row execute function mammoth_guard_review_assignment_target();

create function mammoth_guard_research_review_independence() returns trigger language plpgsql as $$
declare
  author_profile text;
  author_version text;
  target_cell text;
  target_program text;
  target_criterion text;
  target_criterion_digest text;
  reviewer_profile text;
  assignment_target text;
  assignment_work text;
  assignment_version text;
  assignment_role text;
  assignment_reviewer_agent text;
begin
  select model_profile_id, model_profile_version_id, cell_plan_id, program_id,
         criterion_id, criterion_digest
    into author_profile, author_version, target_cell, target_program,
         target_criterion, target_criterion_digest
    from mammoth_research_positions
   where id = new.position_id;
  if author_profile is null then
    raise exception 'review references unknown position';
  end if;
  if author_profile = new.model_profile_id or author_version = new.model_profile_version_id then
    raise exception 'model profile cannot review its own position in the same role';
  end if;
  select profile_id into reviewer_profile
    from mammoth_model_profile_versions where id = new.model_profile_version_id;
  select target_position_id, work_item_id, reviewer_model_profile_version_id, reviewer_role,
         reviewer_agent_id
    into assignment_target, assignment_work, assignment_version, assignment_role,
         assignment_reviewer_agent
    from mammoth_review_assignments where id = new.assignment_id;
  if reviewer_profile is null
     or assignment_target is null
     or reviewer_profile <> new.model_profile_id
     or assignment_target <> new.position_id
     or assignment_work <> new.work_item_id
     or assignment_version <> new.model_profile_version_id
     or assignment_role <> new.reviewer_role
     or assignment_reviewer_agent <> new.authoritative_contract->>'reviewerAgentId'
     or target_cell <> new.cell_plan_id
     or target_program <> new.program_id
     or target_criterion <> new.criterion_id
     or target_criterion_digest <> new.criterion_digest then
    raise exception 'review relational metadata mismatch';
  end if;
  return new;
end;
$$;
create trigger mammoth_research_review_independence
  before insert on mammoth_research_reviews
  for each row execute function mammoth_guard_research_review_independence();
`.trim(),
  }),
  defineMigration({
    version: 6,
    name: 'p5_isolated_divergence',
    sql: `
create table mammoth_p5_cell_attempts (
  id text primary key,
  cell_plan_id text not null references mammoth_cell_plans(id),
  work_item_id text not null references mammoth_work_items(id),
  program_id text not null,
  attempt integer not null check (attempt > 0),
  owner_id text not null,
  fencing_token bigint not null check (fencing_token > 0),
  state text not null check (state in (
    'started','committed','revealed','settling','completed','failed','cancelled'
  )),
  partial_result_digest text check (partial_result_digest is null or partial_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  partial_result jsonb,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  unique (cell_plan_id, attempt),
  unique (cell_plan_id, fencing_token)
);

create table mammoth_p5_isolation_commits (
  id text primary key,
  position_id text not null unique references mammoth_research_positions(id),
  cell_plan_id text not null references mammoth_cell_plans(id),
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  criterion_id text not null,
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_digest text not null check (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  position_digest text not null check (position_digest ~ '^sha256:[0-9a-f]{64}$'),
  isolation_protocol_version text not null check (isolation_protocol_version = '1.0.0'),
  audit_sequence bigint not null check (audit_sequence >= 0),
  committed_at timestamptz not null,
  authoritative_contract jsonb not null,
  check (output_digest = position_digest)
);

create table mammoth_p5_isolation_reveals (
  id text primary key,
  position_id text not null references mammoth_p5_isolation_commits(position_id),
  cell_plan_id text not null references mammoth_cell_plans(id),
  program_id text not null,
  reveal_digest text not null check (reveal_digest ~ '^sha256:[0-9a-f]{64}$'),
  revealed_to_position_ids jsonb not null,
  audit_sequence bigint not null check (audit_sequence >= 0),
  revealed_at timestamptz not null,
  unique (position_id, reveal_digest)
);

create table mammoth_p5_sanitized_review_contexts (
  id text primary key,
  assignment_id text not null unique references mammoth_review_assignments(id),
  target_position_id text not null references mammoth_research_positions(id),
  program_id text not null,
  contract_version text not null check (contract_version = '1.0.0'),
  context_digest text not null check (context_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null
);

create table mammoth_p5_budget_reservations (
  id text primary key,
  stable_identity text not null unique,
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  attempt_id text not null references mammoth_p5_cell_attempts(id),
  ceiling jsonb not null,
  state text not null check (state in ('reserved','settled','released','cancelled')),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table mammoth_p5_budget_settlements (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references mammoth_p5_budget_reservations(id),
  amount jsonb not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  settled_at timestamptz not null
);

create table mammoth_p5_budget_releases (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references mammoth_p5_budget_reservations(id),
  reason text not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  released_at timestamptz not null
);

create table mammoth_p5_provider_charges (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references mammoth_p5_budget_reservations(id),
  provider text not null,
  provider_receipt_id text not null,
  amount jsonb not null,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  charged_at timestamptz not null,
  unique (provider, provider_receipt_id)
);

create table mammoth_p5_cancellation_receipts (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text references mammoth_p5_budget_reservations(id),
  attempt_id text not null references mammoth_p5_cell_attempts(id),
  program_id text not null,
  work_item_id text not null references mammoth_work_items(id),
  cancellation_phase text not null check (cancellation_phase in (
    'before_dispatch','during_generation','after_commit_before_reveal',
    'during_review','during_settlement'
  )),
  consumed jsonb not null,
  released jsonb not null,
  partial_result_digest text check (partial_result_digest is null or partial_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  partial_result jsonb,
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null,
  cancelled_at timestamptz not null
);

create index mammoth_p5_cell_attempts_program_idx
  on mammoth_p5_cell_attempts (program_id, cell_plan_id, state);
create index mammoth_p5_isolation_commits_program_idx
  on mammoth_p5_isolation_commits (program_id, cell_plan_id, audit_sequence);
create index mammoth_p5_isolation_reveals_program_idx
  on mammoth_p5_isolation_reveals (program_id, cell_plan_id, audit_sequence);
create index mammoth_p5_budget_reservations_program_idx
  on mammoth_p5_budget_reservations (program_id, work_item_id, state);
create unique index mammoth_p5_budget_settlements_reservation_unique
  on mammoth_p5_budget_settlements (reservation_id);
create unique index mammoth_p5_budget_releases_reservation_unique
  on mammoth_p5_budget_releases (reservation_id);
create index mammoth_p5_cancellation_receipts_program_idx
  on mammoth_p5_cancellation_receipts (program_id, work_item_id, cancellation_phase);

create function mammoth_p5_immutable_authority_row()
returns trigger
language plpgsql
as $$
begin
  raise exception 'immutable P5 authority row cannot be changed';
end;
$$;

create trigger mammoth_p5_isolation_commits_immutable
  before update or delete on mammoth_p5_isolation_commits
  for each row execute function mammoth_p5_immutable_authority_row();
create trigger mammoth_p5_isolation_reveals_immutable
  before update or delete on mammoth_p5_isolation_reveals
  for each row execute function mammoth_p5_immutable_authority_row();
create trigger mammoth_p5_sanitized_contexts_immutable
  before update or delete on mammoth_p5_sanitized_review_contexts
  for each row execute function mammoth_p5_immutable_authority_row();
create trigger mammoth_p5_budget_settlements_immutable
  before update or delete on mammoth_p5_budget_settlements
  for each row execute function mammoth_p5_immutable_authority_row();
create trigger mammoth_p5_budget_releases_immutable
  before update or delete on mammoth_p5_budget_releases
  for each row execute function mammoth_p5_immutable_authority_row();
create trigger mammoth_p5_provider_charges_immutable
  before update or delete on mammoth_p5_provider_charges
  for each row execute function mammoth_p5_immutable_authority_row();
create trigger mammoth_p5_cancellations_immutable
  before update or delete on mammoth_p5_cancellation_receipts
  for each row execute function mammoth_p5_immutable_authority_row();

create function mammoth_p5_require_budget_amount(value jsonb, label text)
returns void
language plpgsql
as $$
begin
  if coalesce(jsonb_typeof(value), '') <> 'object'
    or coalesce(jsonb_typeof(value -> 'costUsd'), '') <> 'number'
    or coalesce(jsonb_typeof(value -> 'tokens'), '') <> 'number'
    or coalesce(jsonb_typeof(value -> 'durationMs'), '') <> 'number'
  then
    raise exception 'P5 % budget amount must include costUsd, tokens, and durationMs numbers', label;
  end if;
  if (value ->> 'costUsd')::numeric < 0
    or (value ->> 'tokens')::numeric < 0
    or (value ->> 'durationMs')::numeric < 0
  then
    raise exception 'P5 % budget amount cannot be negative', label;
  end if;
end;
$$;

create function mammoth_p5_amount_within_ceiling(amount jsonb, ceiling jsonb)
returns boolean
language sql
immutable
as $$
  select (amount ->> 'costUsd')::numeric <= (ceiling ->> 'costUsd')::numeric
     and (amount ->> 'tokens')::numeric <= (ceiling ->> 'tokens')::numeric
     and (amount ->> 'durationMs')::numeric <= (ceiling ->> 'durationMs')::numeric;
$$;

create function mammoth_p5_amount_pair_within_ceiling(left_amount jsonb, right_amount jsonb, ceiling jsonb)
returns boolean
language sql
immutable
as $$
  select ((left_amount ->> 'costUsd')::numeric + (right_amount ->> 'costUsd')::numeric)
            <= (ceiling ->> 'costUsd')::numeric
     and ((left_amount ->> 'tokens')::numeric + (right_amount ->> 'tokens')::numeric)
            <= (ceiling ->> 'tokens')::numeric
     and ((left_amount ->> 'durationMs')::numeric + (right_amount ->> 'durationMs')::numeric)
            <= (ceiling ->> 'durationMs')::numeric;
$$;

create function mammoth_p5_json_contains_forbidden_attribution(document jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  item record;
  element jsonb;
begin
  if document is null then
    return false;
  end if;
  if jsonb_typeof(document) = 'object' then
    for item in select key, value as nested from jsonb_each(document) loop
      if item.key ~* '(author|attribution|rawReviewerIdentity|modelProfileVersion|providerModel|priorVerdict|upstreamPassMarker)' then
        return true;
      end if;
      if mammoth_p5_json_contains_forbidden_attribution(item.nested) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(document) = 'array' then
    for element in
      select array_element from jsonb_array_elements(document) as array_values(array_element)
    loop
      if mammoth_p5_json_contains_forbidden_attribution(element) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

create function mammoth_p5_guard_isolation_commit()
returns trigger
language plpgsql
as $$
declare
  position_record record;
begin
  select cell_plan_id, program_id, work_item_id, criterion_id,
         criterion_digest, input_digest, position_digest
    into position_record
    from mammoth_research_positions
   where id = new.position_id;
  if position_record is null then
    raise exception 'P5 isolation commit position is missing';
  end if;
  if position_record.cell_plan_id <> new.cell_plan_id
    or position_record.program_id <> new.program_id
    or position_record.work_item_id <> new.work_item_id
    or position_record.criterion_id <> new.criterion_id
    or position_record.criterion_digest <> new.criterion_digest
    or position_record.input_digest <> new.input_digest
    or position_record.position_digest <> new.position_digest
  then
    raise exception 'P5 isolation commit metadata mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_isolation_commit_guard
  before insert on mammoth_p5_isolation_commits
  for each row execute function mammoth_p5_guard_isolation_commit();

create function mammoth_p5_guard_isolation_reveal()
returns trigger
language plpgsql
as $$
declare
  commit_record record;
begin
  select cell_plan_id, program_id, audit_sequence
    into commit_record
    from mammoth_p5_isolation_commits
   where position_id = new.position_id;
  if commit_record is null then
    raise exception 'P5 reveal requires prior isolation commit';
  end if;
  if commit_record.cell_plan_id <> new.cell_plan_id
    or commit_record.program_id <> new.program_id
  then
    raise exception 'P5 reveal metadata mismatch';
  end if;
  if new.audit_sequence <= commit_record.audit_sequence then
    raise exception 'P5 reveal audit sequence must follow commit sequence';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_isolation_reveal_guard
  before insert on mammoth_p5_isolation_reveals
  for each row execute function mammoth_p5_guard_isolation_reveal();

create function mammoth_p5_guard_sanitized_review_context()
returns trigger
language plpgsql
as $$
declare
  assignment_record record;
begin
  select program_id, target_position_id
    into assignment_record
    from mammoth_review_assignments
   where id = new.assignment_id;
  if assignment_record is null then
    raise exception 'P5 sanitized context assignment is missing';
  end if;
  if assignment_record.program_id <> new.program_id
    or assignment_record.target_position_id <> new.target_position_id
  then
    raise exception 'P5 sanitized context assignment mismatch';
  end if;
  if mammoth_p5_json_contains_forbidden_attribution(new.payload) then
    raise exception 'P5 sanitized context contains forbidden attribution';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_sanitized_context_guard
  before insert on mammoth_p5_sanitized_review_contexts
  for each row execute function mammoth_p5_guard_sanitized_review_context();

create function mammoth_p5_guard_budget_reservation_insert()
returns trigger
language plpgsql
as $$
declare
  attempt_record record;
begin
  perform mammoth_p5_require_budget_amount(new.ceiling, 'ceiling');
  select program_id, work_item_id
    into attempt_record
    from mammoth_p5_cell_attempts
   where id = new.attempt_id;
  if attempt_record is null then
    raise exception 'P5 budget reservation attempt is missing';
  end if;
  if attempt_record.program_id <> new.program_id
    or attempt_record.work_item_id <> new.work_item_id
  then
    raise exception 'P5 budget reservation attempt mismatch';
  end if;
  if new.state <> 'reserved' or new.revision <> 0 then
    raise exception 'P5 budget reservation must start reserved at revision zero';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_budget_reservation_insert_guard
  before insert on mammoth_p5_budget_reservations
  for each row execute function mammoth_p5_guard_budget_reservation_insert();

create function mammoth_p5_guard_budget_reservation_update()
returns trigger
language plpgsql
as $$
begin
  if old.id <> new.id
    or old.stable_identity <> new.stable_identity
    or old.program_id <> new.program_id
    or old.work_item_id <> new.work_item_id
    or old.attempt_id <> new.attempt_id
    or old.ceiling <> new.ceiling
    or old.created_at <> new.created_at
  then
    raise exception 'P5 budget reservation identity fields are immutable';
  end if;
  if old.state <> 'reserved' then
    raise exception 'P5 terminal budget reservation cannot change';
  end if;
  if new.state not in ('settled', 'released', 'cancelled')
    or new.revision <> old.revision + 1
  then
    raise exception 'P5 budget reservation transition is invalid';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_budget_reservation_update_guard
  before update on mammoth_p5_budget_reservations
  for each row execute function mammoth_p5_guard_budget_reservation_update();
create trigger mammoth_p5_budget_reservation_delete_guard
  before delete on mammoth_p5_budget_reservations
  for each row execute function mammoth_p5_immutable_authority_row();

create function mammoth_p5_guard_budget_settlement()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
begin
  perform mammoth_p5_require_budget_amount(new.amount, 'settlement');
  select ceiling, state
    into reservation_record
    from mammoth_p5_budget_reservations
   where id = new.reservation_id;
  if reservation_record is null then
    raise exception 'P5 budget settlement reservation is missing';
  end if;
  if reservation_record.state <> 'reserved' then
    raise exception 'P5 budget settlement requires an unsettled reservation';
  end if;
  if not mammoth_p5_amount_within_ceiling(new.amount, reservation_record.ceiling) then
    raise exception 'P5 budget settlement exceeds reservation ceiling';
  end if;
  if exists (
    select 1 from mammoth_p5_budget_releases where reservation_id = new.reservation_id
  ) then
    raise exception 'P5 budget settlement cannot follow release';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_budget_settlement_guard
  before insert on mammoth_p5_budget_settlements
  for each row execute function mammoth_p5_guard_budget_settlement();

create function mammoth_p5_guard_budget_release()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
begin
  select state
    into reservation_record
    from mammoth_p5_budget_reservations
   where id = new.reservation_id;
  if reservation_record is null then
    raise exception 'P5 budget release reservation is missing';
  end if;
  if reservation_record.state <> 'reserved' then
    raise exception 'P5 budget release requires an unsettled reservation';
  end if;
  if exists (
    select 1 from mammoth_p5_budget_settlements where reservation_id = new.reservation_id
  ) then
    raise exception 'P5 budget release cannot follow settlement';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_budget_release_guard
  before insert on mammoth_p5_budget_releases
  for each row execute function mammoth_p5_guard_budget_release();

create function mammoth_p5_guard_provider_charge()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
  prior_cost numeric;
  prior_tokens numeric;
  prior_duration numeric;
begin
  perform mammoth_p5_require_budget_amount(new.amount, 'provider charge');
  select ceiling, state
    into reservation_record
    from mammoth_p5_budget_reservations
   where id = new.reservation_id;
  if reservation_record is null then
    raise exception 'P5 provider charge reservation is missing';
  end if;
  if reservation_record.state not in ('reserved', 'settled') then
    raise exception 'P5 provider charge requires an active or settled reservation';
  end if;
  if not mammoth_p5_amount_within_ceiling(new.amount, reservation_record.ceiling) then
    raise exception 'P5 provider charge exceeds reservation ceiling';
  end if;
  select coalesce(sum((amount ->> 'costUsd')::numeric), 0),
         coalesce(sum((amount ->> 'tokens')::numeric), 0),
         coalesce(sum((amount ->> 'durationMs')::numeric), 0)
    into prior_cost, prior_tokens, prior_duration
    from mammoth_p5_provider_charges
   where reservation_id = new.reservation_id;
  if prior_cost + (new.amount ->> 'costUsd')::numeric > (reservation_record.ceiling ->> 'costUsd')::numeric
    or prior_tokens + (new.amount ->> 'tokens')::numeric > (reservation_record.ceiling ->> 'tokens')::numeric
    or prior_duration + (new.amount ->> 'durationMs')::numeric > (reservation_record.ceiling ->> 'durationMs')::numeric
  then
    raise exception 'P5 provider charge aggregate exceeds reservation ceiling';
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_provider_charge_guard
  before insert on mammoth_p5_provider_charges
  for each row execute function mammoth_p5_guard_provider_charge();

create function mammoth_p5_guard_cancellation_receipt()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
  attempt_record record;
begin
  perform mammoth_p5_require_budget_amount(new.consumed, 'cancellation consumed');
  perform mammoth_p5_require_budget_amount(new.released, 'cancellation released');
  select program_id, work_item_id
    into attempt_record
    from mammoth_p5_cell_attempts
   where id = new.attempt_id;
  if attempt_record is null then
    raise exception 'P5 cancellation attempt is missing';
  end if;
  if attempt_record.program_id <> new.program_id
    or attempt_record.work_item_id <> new.work_item_id
  then
    raise exception 'P5 cancellation attempt mismatch';
  end if;
  if new.reservation_id is not null then
    select ceiling
      into reservation_record
      from mammoth_p5_budget_reservations
     where id = new.reservation_id;
    if reservation_record is null then
      raise exception 'P5 cancellation reservation is missing';
    end if;
    if not mammoth_p5_amount_pair_within_ceiling(
      new.consumed,
      new.released,
      reservation_record.ceiling
    )
    then
      raise exception 'P5 cancellation amount exceeds reservation ceiling';
    end if;
  end if;
  return new;
end;
$$;

create trigger mammoth_p5_cancellation_receipt_guard
  before insert on mammoth_p5_cancellation_receipts
  for each row execute function mammoth_p5_guard_cancellation_receipt();
`.trim(),
  }),
  defineMigration({
    version: 7,
    name: 'p6_research_topology',
    sql: `
create table mammoth_p6_topology_plans (
  id text primary key,
  stable_identity text not null unique,
  program_id text not null,
  criterion_id text not null,
  criterion_version integer not null check (criterion_version > 0),
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  topology_plan_version text not null check (topology_plan_version = '1.0.0'),
  planner_policy_version text not null check (planner_policy_version = '1.0.0'),
  template_catalog_version text not null check (template_catalog_version = '1.0.0'),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  budget_policy_version text not null check (budget_policy_version = '1.0.0'),
  concurrency_limit integer not null check (concurrency_limit > 0),
  budget_ceiling jsonb not null,
  plan_digest text not null check (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in (
    'idle_no_ready_work',
    'blocked_dependency',
    'budget_starved',
    'concurrency_saturated',
    'failed_policy',
    'cancelled',
    'complete'
  )),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  authoritative_contract jsonb not null
);

create table mammoth_p6_topology_cells (
  id text primary key,
  stable_identity text not null unique,
  topology_id text not null references mammoth_p6_topology_plans(id),
  program_id text not null,
  node_id text not null,
  template_id text not null,
  template_version text not null check (template_version = '1.0.0'),
  dependency_digest text not null check (dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  work_item_contract_digest text not null check (work_item_contract_digest ~ '^sha256:[0-9a-f]{64}$'),
  criterion_id text not null,
  criterion_version integer not null check (criterion_version > 0),
  criterion_digest text not null check (criterion_digest ~ '^sha256:[0-9a-f]{64}$'),
  role text not null,
  state text not null check (state in ('planned','ready','running','succeeded','failed','cancelled','blocked')),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  authoritative_contract jsonb not null,
  unique (topology_id, node_id)
);

create table mammoth_p6_topology_dependencies (
  id text primary key,
  topology_id text not null references mammoth_p6_topology_plans(id),
  program_id text not null,
  from_cell_id text not null references mammoth_p6_topology_cells(id),
  to_cell_id text not null references mammoth_p6_topology_cells(id),
  artifact_kind text not null check (artifact_kind in (
    'claim_set',
    'evidence_snapshot',
    'hypothesis_set',
    'position_set',
    'prior_art_record',
    'falsification_result',
    'experiment_receipt',
    'synthesis_input'
  )),
  dependency_digest text not null check (dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null,
  check (from_cell_id <> to_cell_id),
  unique (topology_id, from_cell_id, to_cell_id, artifact_kind)
);

create table mammoth_p6_topology_attempts (
  id text primary key,
  stable_identity text not null unique,
  topology_id text not null references mammoth_p6_topology_plans(id),
  cell_id text not null references mammoth_p6_topology_cells(id),
  program_id text not null,
  attempt integer not null check (attempt > 0),
  child_workflow_id text not null,
  run_partition text not null,
  state text not null check (state in ('started','succeeded','failed','cancelled')),
  started_at timestamptz not null,
  completed_at timestamptz,
  partial_result_digest text check (partial_result_digest is null or partial_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_ids jsonb not null,
  unique (cell_id, attempt),
  unique (child_workflow_id)
);

create table mammoth_p6_topology_budget_reservations (
  id text primary key,
  stable_identity text not null unique,
  topology_id text not null references mammoth_p6_topology_plans(id),
  cell_id text not null references mammoth_p6_topology_cells(id),
  attempt_id text not null references mammoth_p6_topology_attempts(id),
  program_id text not null,
  ceiling jsonb not null,
  state text not null check (state in ('reserved','settled','released','cancelled')),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table mammoth_p6_topology_budget_settlements (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  amount jsonb not null,
  settled_at timestamptz not null,
  receipt_id text not null unique,
  unique (reservation_id)
);

create table mammoth_p6_topology_budget_releases (
  id text primary key,
  stable_identity text not null unique,
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  released_at timestamptz not null,
  receipt_id text not null unique,
  unique (reservation_id)
);

create table mammoth_p6_topology_cancellation_receipts (
  id text primary key,
  stable_identity text not null unique,
  topology_id text not null references mammoth_p6_topology_plans(id),
  cell_id text references mammoth_p6_topology_cells(id),
  attempt_id text references mammoth_p6_topology_attempts(id),
  reservation_id text references mammoth_p6_topology_budget_reservations(id),
  program_id text not null,
  reason text not null,
  consumed jsonb not null,
  released jsonb not null,
  partial_result_digest text check (partial_result_digest is null or partial_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  cancelled_at timestamptz not null
);

create table mammoth_p6_topology_scheduler_snapshots (
  id text primary key,
  topology_id text not null references mammoth_p6_topology_plans(id),
  program_id text not null,
  state text not null check (state in (
    'idle_no_ready_work',
    'blocked_dependency',
    'budget_starved',
    'concurrency_saturated',
    'failed_policy',
    'cancelled',
    'complete'
  )),
  ready_cell_ids jsonb not null,
  running_cell_ids jsonb not null,
  blocked_cell_ids jsonb not null,
  budget_starved_cell_ids jsonb not null,
  concurrency_limit integer not null check (concurrency_limit > 0),
  recorded_at timestamptz not null,
  digest text not null check (digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p6_topology_receipts (
  id text primary key,
  stable_identity text not null unique,
  topology_id text not null references mammoth_p6_topology_plans(id),
  program_id text not null,
  kind text not null check (kind in (
    'plan_committed',
    'cell_dispatched',
    'cell_completed',
    'cell_failed',
    'budget_reserved',
    'budget_settled',
    'budget_released',
    'cancelled',
    'reconstructed'
  )),
  payload_digest text not null check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz not null
);

create index mammoth_p6_topology_plan_program_idx
  on mammoth_p6_topology_plans (program_id, state);
create index mammoth_p6_topology_cell_program_idx
  on mammoth_p6_topology_cells (program_id, topology_id, state);
create index mammoth_p6_topology_attempt_program_idx
  on mammoth_p6_topology_attempts (program_id, topology_id, cell_id, attempt);
create index mammoth_p6_topology_reservation_program_idx
  on mammoth_p6_topology_budget_reservations (program_id, topology_id, state);

create function mammoth_p6_amount_field(amount jsonb, key text) returns numeric
language plpgsql
immutable
as $$
begin
  return (amount ->> key)::numeric;
end;
$$;

create function mammoth_p6_require_budget_amount(amount jsonb, label text)
returns void
language plpgsql
as $$
begin
  if amount is null
    or jsonb_typeof(amount) <> 'object'
    or not amount ? 'costUsd'
    or not amount ? 'tokens'
    or not amount ? 'durationMs'
    or mammoth_p6_amount_field(amount, 'costUsd') < 0
    or mammoth_p6_amount_field(amount, 'tokens') < 0
    or mammoth_p6_amount_field(amount, 'durationMs') < 0
  then
    raise exception 'P6 invalid budget amount: %', label;
  end if;
end;
$$;

create function mammoth_p6_amount_within_ceiling(amount jsonb, ceiling jsonb)
returns boolean
language plpgsql
immutable
as $$
begin
  return mammoth_p6_amount_field(amount, 'costUsd') <= mammoth_p6_amount_field(ceiling, 'costUsd')
    and mammoth_p6_amount_field(amount, 'tokens') <= mammoth_p6_amount_field(ceiling, 'tokens')
    and mammoth_p6_amount_field(amount, 'durationMs') <= mammoth_p6_amount_field(ceiling, 'durationMs');
end;
$$;

create function mammoth_p6_amount_pair_within_ceiling(left_amount jsonb, right_amount jsonb, ceiling jsonb)
returns boolean
language plpgsql
immutable
as $$
begin
  return mammoth_p6_amount_field(left_amount, 'costUsd') + mammoth_p6_amount_field(right_amount, 'costUsd') <= mammoth_p6_amount_field(ceiling, 'costUsd')
    and mammoth_p6_amount_field(left_amount, 'tokens') + mammoth_p6_amount_field(right_amount, 'tokens') <= mammoth_p6_amount_field(ceiling, 'tokens')
    and mammoth_p6_amount_field(left_amount, 'durationMs') + mammoth_p6_amount_field(right_amount, 'durationMs') <= mammoth_p6_amount_field(ceiling, 'durationMs');
end;
$$;

create function mammoth_p6_guard_budget_reservation_insert()
returns trigger
language plpgsql
as $$
declare
  attempt_record record;
begin
  perform mammoth_p6_require_budget_amount(new.ceiling, 'topology reservation ceiling');
  select topology_id, cell_id, program_id into attempt_record
    from mammoth_p6_topology_attempts
   where id = new.attempt_id;
  if attempt_record is null then
    raise exception 'P6 topology reservation attempt is missing';
  end if;
  if attempt_record.topology_id <> new.topology_id
    or attempt_record.cell_id <> new.cell_id
    or attempt_record.program_id <> new.program_id
  then
    raise exception 'P6 topology reservation attempt mismatch';
  end if;
  if new.state <> 'reserved' or new.revision <> 0 then
    raise exception 'P6 topology budget reservation must start reserved at revision zero';
  end if;
  return new;
end;
$$;

create trigger mammoth_p6_topology_budget_reservation_insert_guard
  before insert on mammoth_p6_topology_budget_reservations
  for each row execute function mammoth_p6_guard_budget_reservation_insert();

create function mammoth_p6_guard_budget_reservation_update()
returns trigger
language plpgsql
as $$
begin
  if old.id <> new.id
    or old.stable_identity <> new.stable_identity
    or old.topology_id <> new.topology_id
    or old.cell_id <> new.cell_id
    or old.attempt_id <> new.attempt_id
    or old.program_id <> new.program_id
    or old.ceiling <> new.ceiling
    or old.created_at <> new.created_at
  then
    raise exception 'P6 topology budget reservation identity fields are immutable';
  end if;
  if old.state <> 'reserved' then
    raise exception 'P6 terminal topology budget reservation cannot change';
  end if;
  if new.state not in ('settled','released','cancelled')
    or new.revision <> old.revision + 1
  then
    raise exception 'P6 topology budget reservation transition is invalid';
  end if;
  return new;
end;
$$;

create trigger mammoth_p6_topology_budget_reservation_update_guard
  before update on mammoth_p6_topology_budget_reservations
  for each row execute function mammoth_p6_guard_budget_reservation_update();

create function mammoth_p6_guard_budget_settlement()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
begin
  perform mammoth_p6_require_budget_amount(new.amount, 'topology settlement');
  select ceiling, state into reservation_record
    from mammoth_p6_topology_budget_reservations
   where id = new.reservation_id;
  if reservation_record is null then
    raise exception 'P6 topology budget settlement reservation is missing';
  end if;
  if reservation_record.state <> 'reserved' then
    raise exception 'P6 topology budget settlement requires an unsettled reservation';
  end if;
  if not mammoth_p6_amount_within_ceiling(new.amount, reservation_record.ceiling) then
    raise exception 'P6 topology budget settlement exceeds reservation ceiling';
  end if;
  if exists (
    select 1 from mammoth_p6_topology_budget_releases where reservation_id = new.reservation_id
  ) then
    raise exception 'P6 topology budget settlement cannot follow release';
  end if;
  return new;
end;
$$;

create trigger mammoth_p6_topology_budget_settlement_guard
  before insert on mammoth_p6_topology_budget_settlements
  for each row execute function mammoth_p6_guard_budget_settlement();

create function mammoth_p6_guard_budget_release()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
begin
  select state into reservation_record
    from mammoth_p6_topology_budget_reservations
   where id = new.reservation_id;
  if reservation_record is null then
    raise exception 'P6 topology budget release reservation is missing';
  end if;
  if reservation_record.state <> 'reserved' then
    raise exception 'P6 topology budget release requires an unsettled reservation';
  end if;
  if exists (
    select 1 from mammoth_p6_topology_budget_settlements where reservation_id = new.reservation_id
  ) then
    raise exception 'P6 topology budget release cannot follow settlement';
  end if;
  return new;
end;
$$;

create trigger mammoth_p6_topology_budget_release_guard
  before insert on mammoth_p6_topology_budget_releases
  for each row execute function mammoth_p6_guard_budget_release();

create function mammoth_p6_guard_cancellation_receipt()
returns trigger
language plpgsql
as $$
declare
  reservation_record record;
begin
  perform mammoth_p6_require_budget_amount(new.consumed, 'topology cancellation consumed');
  perform mammoth_p6_require_budget_amount(new.released, 'topology cancellation released');
  if new.reservation_id is not null then
    select ceiling into reservation_record
      from mammoth_p6_topology_budget_reservations
     where id = new.reservation_id;
    if reservation_record is null then
      raise exception 'P6 topology cancellation reservation is missing';
    end if;
    if not mammoth_p6_amount_pair_within_ceiling(new.consumed, new.released, reservation_record.ceiling) then
      raise exception 'P6 topology cancellation amount exceeds reservation ceiling';
    end if;
  end if;
  return new;
end;
$$;

create trigger mammoth_p6_topology_cancellation_receipt_guard
  before insert on mammoth_p6_topology_cancellation_receipts
  for each row execute function mammoth_p6_guard_cancellation_receipt();

create function mammoth_p6_forbid_authority_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'P6 topology authority rows are immutable';
end;
$$;

create function mammoth_p6_forbid_authority_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'P6 topology authority rows cannot be deleted';
end;
$$;

create trigger mammoth_p6_topology_plans_update_guard
  before update on mammoth_p6_topology_plans
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_plans_delete_guard
  before delete on mammoth_p6_topology_plans
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_cells_update_guard
  before update on mammoth_p6_topology_cells
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_cells_delete_guard
  before delete on mammoth_p6_topology_cells
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_dependencies_update_guard
  before update on mammoth_p6_topology_dependencies
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_dependencies_delete_guard
  before delete on mammoth_p6_topology_dependencies
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_attempts_update_guard
  before update on mammoth_p6_topology_attempts
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_attempts_delete_guard
  before delete on mammoth_p6_topology_attempts
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_budget_settlements_update_guard
  before update on mammoth_p6_topology_budget_settlements
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_budget_settlements_delete_guard
  before delete on mammoth_p6_topology_budget_settlements
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_budget_releases_update_guard
  before update on mammoth_p6_topology_budget_releases
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_budget_releases_delete_guard
  before delete on mammoth_p6_topology_budget_releases
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_cancellation_receipts_update_guard
  before update on mammoth_p6_topology_cancellation_receipts
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_cancellation_receipts_delete_guard
  before delete on mammoth_p6_topology_cancellation_receipts
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_scheduler_snapshots_update_guard
  before update on mammoth_p6_topology_scheduler_snapshots
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_scheduler_snapshots_delete_guard
  before delete on mammoth_p6_topology_scheduler_snapshots
  for each row execute function mammoth_p6_forbid_authority_delete();

create trigger mammoth_p6_topology_receipts_update_guard
  before update on mammoth_p6_topology_receipts
  for each row execute function mammoth_p6_forbid_authority_update();
create trigger mammoth_p6_topology_receipts_delete_guard
  before delete on mammoth_p6_topology_receipts
  for each row execute function mammoth_p6_forbid_authority_delete();
`.trim(),
  }),
  defineMigration({
    version: 8,
    name: 'p7_provider_model_work',
    sql: `
create table mammoth_p7_model_work (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  program_id text not null,
  topology_id text not null references mammoth_p6_topology_plans(id),
  cell_id text not null references mammoth_p6_topology_cells(id),
  topology_attempt_id text not null references mammoth_p6_topology_attempts(id),
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  provider_effect_key text not null unique check (provider_effect_key ~ '^sha256:[0-9a-f]{64}$'),
  authoritative_request jsonb not null,
  state text not null check (state in (
    'planned','in_flight','ambiguous','completed','failed','cancelled'
  )),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table mammoth_p7_provider_attempts (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  model_work_identity_digest text not null check (model_work_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  attempt_ordinal integer not null check (attempt_ordinal > 0),
  provider text not null,
  concrete_model text not null,
  checkpoint text not null,
  capability_manifest_digest text not null check (capability_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  authoritative_request jsonb not null,
  predecessor_attempt_id text references mammoth_p7_provider_attempts(id),
  predecessor_reason text,
  state text not null check (state in ('planned','in_flight','ambiguous','completed','failed')),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (model_work_id, attempt_ordinal),
  check ((attempt_ordinal = 1) = (predecessor_attempt_id is null)),
  check ((predecessor_attempt_id is null) = (predecessor_reason is null))
);

create table mammoth_p7_capability_decisions (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  provider_attempt_id text not null references mammoth_p7_provider_attempts(id),
  manifest jsonb not null,
  decision text not null check (decision in ('allowed','denied')),
  reason text not null,
  recorded_at timestamptz not null,
  decision_digest text not null unique check (decision_digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p7_egress_decisions (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  provider_attempt_id text not null references mammoth_p7_provider_attempts(id),
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  data_classification text not null check (data_classification in ('local_only','cloud_allowed')),
  provider text not null,
  concrete_model text not null,
  checkpoint text not null,
  destination_origin text not null,
  allowed_tools jsonb not null check (allowed_tools = '[]'::jsonb),
  prompt_digest text not null check (prompt_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_version text not null check (policy_version = '1.0.0'),
  policy_digest text not null check (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision text not null check (decision in ('allowed','denied')),
  reason text not null,
  recorded_at timestamptz not null,
  decision_digest text not null unique check (decision_digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p7_artifact_references (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  provider_attempt_id text not null references mammoth_p7_provider_attempts(id),
  kind text not null check (kind in (
    'canonical_prompt','raw_provider_response','typed_output','validation_residue'
  )),
  digest text not null check (digest ~ '^sha256:[0-9a-f]{64}$'),
  byte_length bigint not null check (byte_length >= 0),
  data_classification text not null check (data_classification = 'local_only'),
  retention text not null check (retention in ('retained','deleted_after_validation')),
  deletion_receipt_digest text check (deletion_receipt_digest is null or deletion_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_verdict text not null check (validation_verdict in ('pending','accepted','rejected')),
  created_at timestamptz not null,
  unique (model_work_id, kind, digest),
  check ((retention = 'deleted_after_validation') = (deletion_receipt_digest is not null))
);

create table mammoth_p7_validation_residue (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  provider_attempt_id text not null references mammoth_p7_provider_attempts(id),
  artifact_id text not null references mammoth_p7_artifact_references(id),
  verdict text not null check (verdict in ('accepted','rejected')),
  code text not null,
  redacted_summary text not null,
  recorded_at timestamptz not null,
  residue_digest text not null unique check (residue_digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p7_provider_charges (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  provider_attempt_id text not null references mammoth_p7_provider_attempts(id),
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  provider_effect_key text not null unique check (provider_effect_key ~ '^sha256:[0-9a-f]{64}$'),
  provider text not null,
  provider_operation_id text not null,
  usage jsonb not null,
  price_version text not null,
  currency_conversion_policy text not null,
  charged_at timestamptz not null,
  receipt_digest text not null unique check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  unique (provider, provider_operation_id)
);

create table mammoth_p7_budget_settlements (
  id text primary key references mammoth_p6_topology_budget_settlements(id),
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  reservation_id text not null unique references mammoth_p6_topology_budget_reservations(id),
  provider_charge_id text not null unique references mammoth_p7_provider_charges(id),
  amount jsonb not null,
  settled_at timestamptz not null,
  receipt_digest text not null unique check (receipt_digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p7_budget_releases (
  id text primary key references mammoth_p6_topology_budget_releases(id),
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null references mammoth_p7_model_work(id),
  reservation_id text not null unique references mammoth_p6_topology_budget_reservations(id),
  reason text not null,
  released_at timestamptz not null,
  receipt_digest text not null unique check (receipt_digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p7_cancellation_fences (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null unique references mammoth_p7_model_work(id),
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  phase text not null check (phase in (
    'before_call','during_call','after_response_before_cas',
    'after_cas_before_admission','during_settlement','during_synthesis'
  )),
  reason text not null,
  requested_at timestamptz not null,
  fence_digest text not null unique check (fence_digest ~ '^sha256:[0-9a-f]{64}$')
);

create table mammoth_p7_reconstruction_links (
  id text primary key,
  stable_identity text not null unique check (stable_identity ~ '^sha256:[0-9a-f]{64}$'),
  model_work_id text not null unique references mammoth_p7_model_work(id),
  activity_effect_id text not null references mammoth_activity_effects(id),
  topology_attempt_id text not null references mammoth_p6_topology_attempts(id),
  reservation_id text not null references mammoth_p6_topology_budget_reservations(id),
  artifact_ids jsonb not null,
  provider_charge_id text references mammoth_p7_provider_charges(id),
  settlement_id text references mammoth_p7_budget_settlements(id),
  cancellation_fence_id text references mammoth_p7_cancellation_fences(id),
  completed_receipt_digest text check (completed_receipt_digest is null or completed_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz not null,
  link_digest text not null unique check (link_digest ~ '^sha256:[0-9a-f]{64}$')
);

create index mammoth_p7_model_work_program_idx
  on mammoth_p7_model_work (program_id, topology_id, state);
create index mammoth_p7_attempt_model_work_idx
  on mammoth_p7_provider_attempts (model_work_id, attempt_ordinal, state);
create index mammoth_p7_artifact_model_work_idx
  on mammoth_p7_artifact_references (model_work_id, kind, validation_verdict);

create function mammoth_p7_require_usage(value jsonb, label text)
returns void
language plpgsql
as $$
begin
  if coalesce(jsonb_typeof(value), '') <> 'object'
    or (select count(*) from jsonb_object_keys(value)) <> 5
    or coalesce(jsonb_typeof(value -> 'inputTokens'), '') <> 'number'
    or coalesce(jsonb_typeof(value -> 'outputTokens'), '') <> 'number'
    or coalesce(jsonb_typeof(value -> 'currencyMicros'), '') <> 'number'
    or coalesce(jsonb_typeof(value -> 'wallClockMs'), '') <> 'number'
    or coalesce(jsonb_typeof(value -> 'toolCalls'), '') <> 'number'
  then
    raise exception 'P7 % must contain the exact usage fields', label;
  end if;
  if (value ->> 'inputTokens')::numeric < 0
    or (value ->> 'outputTokens')::numeric < 0
    or (value ->> 'currencyMicros')::numeric < 0
    or (value ->> 'wallClockMs')::numeric < 0
    or (value ->> 'toolCalls')::numeric <> 0
  then
    raise exception 'P7 % usage values are invalid', label;
  end if;
end;
$$;

create function mammoth_p7_forbid_authority_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'P7 authority rows are immutable';
end;
$$;

create function mammoth_p7_guard_model_work_insert()
returns trigger
language plpgsql
as $$
declare
  topology_attempt record;
  reservation record;
begin
  select topology_id, cell_id, program_id into topology_attempt
    from mammoth_p6_topology_attempts where id = new.topology_attempt_id;
  select topology_id, cell_id, attempt_id, program_id, ceiling, state into reservation
    from mammoth_p6_topology_budget_reservations where id = new.reservation_id;
  if topology_attempt is null or reservation is null
    or topology_attempt.topology_id <> new.topology_id
    or topology_attempt.cell_id <> new.cell_id
    or topology_attempt.program_id <> new.program_id
    or reservation.topology_id <> new.topology_id
    or reservation.cell_id <> new.cell_id
    or reservation.attempt_id <> new.topology_attempt_id
    or reservation.program_id <> new.program_id
    or reservation.state <> 'reserved'
    or (new.authoritative_request #>> '{budget,currencyMicros}')::numeric / 1000000 > (reservation.ceiling ->> 'costUsd')::numeric
    or ((new.authoritative_request #>> '{budget,inputTokens}')::numeric
      + (new.authoritative_request #>> '{budget,outputTokens}')::numeric) > (reservation.ceiling ->> 'tokens')::numeric
    or (new.authoritative_request #>> '{budget,wallClockMs}')::numeric > (reservation.ceiling ->> 'durationMs')::numeric
  then
    raise exception 'P7 model-work P6 authority references do not match';
  end if;
  if new.stable_identity <> new.authoritative_request #>> '{identity,identityDigest}'
    or new.program_id <> new.authoritative_request #>> '{identity,programId}'
    or new.topology_id <> new.authoritative_request #>> '{identity,topologyId}'
    or new.cell_id <> new.authoritative_request #>> '{identity,cellId}'
    or new.provider_effect_key <> new.authoritative_request #>> '{effect,idempotencyKey}'
    or new.state <> 'planned' or new.revision <> 0
  then
    raise exception 'P7 model-work authoritative request does not match columns';
  end if;
  perform mammoth_p7_require_usage(new.authoritative_request -> 'budget', 'budget');
  return new;
end;
$$;

create trigger mammoth_p7_model_work_insert_guard
  before insert on mammoth_p7_model_work
  for each row execute function mammoth_p7_guard_model_work_insert();

create function mammoth_p7_guard_model_work_update()
returns trigger
language plpgsql
as $$
begin
  if old.id is distinct from new.id
    or old.stable_identity is distinct from new.stable_identity
    or old.program_id is distinct from new.program_id
    or old.topology_id is distinct from new.topology_id
    or old.cell_id is distinct from new.cell_id
    or old.topology_attempt_id is distinct from new.topology_attempt_id
    or old.reservation_id is distinct from new.reservation_id
    or old.provider_effect_key is distinct from new.provider_effect_key
    or old.authoritative_request is distinct from new.authoritative_request
    or new.revision <> old.revision + 1
  then
    raise exception 'P7 model-work identity is immutable and revisions are CAS guarded';
  end if;
  if old.state in ('completed','failed','cancelled')
    or (old.state = 'planned' and new.state not in ('in_flight','failed','cancelled'))
    or (old.state = 'in_flight' and new.state not in ('ambiguous','completed','failed','cancelled'))
    or (old.state = 'ambiguous' and new.state not in ('completed','failed','cancelled'))
  then
    raise exception 'P7 model-work state transition is invalid';
  end if;
  if new.state = 'completed' and exists (
    select 1 from mammoth_p7_cancellation_fences where model_work_id = new.id
  ) then
    raise exception 'P7 cancelled model work cannot complete';
  end if;
  if new.state = 'completed' and not exists (
    select 1 from mammoth_p7_provider_attempts attempt
     where attempt.model_work_id = new.id and attempt.state = 'completed'
       and exists (
         select 1 from mammoth_p7_capability_decisions capability
          where capability.provider_attempt_id = attempt.id
            and capability.decision = 'allowed'
       )
       and exists (
         select 1 from mammoth_p7_egress_decisions egress
          where egress.provider_attempt_id = attempt.id
            and egress.decision = 'allowed'
       )
       and exists (
         select 1 from mammoth_p7_artifact_references artifact
          where artifact.provider_attempt_id = attempt.id
            and artifact.kind = 'typed_output'
            and artifact.validation_verdict = 'accepted'
       )
       and exists (
         select 1 from mammoth_p7_provider_charges charge
          join mammoth_p7_budget_settlements settlement
            on settlement.provider_charge_id = charge.id
          where charge.provider_attempt_id = attempt.id
            and settlement.model_work_id = new.id
       )
  ) then
    raise exception 'P7 model work lacks completion authority';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_model_work_update_guard
  before update on mammoth_p7_model_work
  for each row execute function mammoth_p7_guard_model_work_update();
create trigger mammoth_p7_model_work_delete_guard
  before delete on mammoth_p7_model_work
  for each row execute function mammoth_p7_forbid_authority_mutation();

create function mammoth_p7_guard_provider_attempt()
returns trigger
language plpgsql
as $$
declare
  work record;
  predecessor record;
begin
  select stable_identity, authoritative_request into work
    from mammoth_p7_model_work where id = new.model_work_id;
  if work is null
    or new.model_work_identity_digest <> work.stable_identity
    or new.model_work_identity_digest <> new.authoritative_request #>> '{identity,identityDigest}'
    or new.stable_identity <> new.authoritative_request #>> '{attempt,attemptDigest}'
    or new.attempt_ordinal <> (new.authoritative_request #>> '{attempt,attemptOrdinal}')::integer
    or new.provider <> new.authoritative_request #>> '{attempt,provider}'
    or new.concrete_model <> new.authoritative_request #>> '{attempt,concreteModel}'
    or new.checkpoint <> new.authoritative_request #>> '{attempt,checkpoint}'
    or new.capability_manifest_digest <> new.authoritative_request #>> '{capabilityManifestDigest}'
    or new.state <> 'planned' or new.revision <> 0
  then
    raise exception 'P7 provider-attempt identity mismatch';
  end if;
  if new.predecessor_attempt_id is not null then
    select model_work_id, state into predecessor
      from mammoth_p7_provider_attempts where id = new.predecessor_attempt_id;
    if predecessor is null or predecessor.model_work_id <> new.model_work_id
      or predecessor.state <> 'failed'
      or new.authoritative_request #>> '{attempt,predecessorAttemptDigest}'
        <> (select stable_identity from mammoth_p7_provider_attempts
              where id = new.predecessor_attempt_id)
    then
      raise exception 'P7 provider predecessor is not terminal';
    end if;
  elsif new.attempt_ordinal <> 1
    or new.stable_identity <> work.authoritative_request #>> '{attempt,attemptDigest}'
  then
    raise exception 'P7 initial provider attempt does not match model-work request';
  end if;
  if exists (
    select 1 from mammoth_p7_cancellation_fences
     where model_work_id = new.model_work_id
  ) then
    raise exception 'P7 cancelled model work cannot start a provider attempt';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_provider_attempt_guard
  before insert on mammoth_p7_provider_attempts
  for each row execute function mammoth_p7_guard_provider_attempt();

create function mammoth_p7_guard_provider_attempt_update()
returns trigger
language plpgsql
as $$
begin
  if old.id is distinct from new.id
    or old.stable_identity is distinct from new.stable_identity
    or old.model_work_id is distinct from new.model_work_id
    or old.model_work_identity_digest is distinct from new.model_work_identity_digest
    or old.attempt_ordinal is distinct from new.attempt_ordinal
    or old.provider is distinct from new.provider
    or old.concrete_model is distinct from new.concrete_model
    or old.checkpoint is distinct from new.checkpoint
    or old.capability_manifest_digest is distinct from new.capability_manifest_digest
    or old.authoritative_request is distinct from new.authoritative_request
    or old.predecessor_attempt_id is distinct from new.predecessor_attempt_id
    or old.predecessor_reason is distinct from new.predecessor_reason
    or new.revision <> old.revision + 1
  then
    raise exception 'P7 provider-attempt identity is immutable and revisions are CAS guarded';
  end if;
  if old.state in ('completed','failed')
    or (old.state = 'planned' and new.state not in ('in_flight','failed'))
    or (old.state = 'in_flight' and new.state not in ('ambiguous','completed','failed'))
    or (old.state = 'ambiguous' and new.state not in ('completed','failed'))
  then
    raise exception 'P7 provider-attempt state transition is invalid';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_provider_attempt_update_guard
  before update on mammoth_p7_provider_attempts
  for each row execute function mammoth_p7_guard_provider_attempt_update();
create trigger mammoth_p7_provider_attempt_delete_guard
  before delete on mammoth_p7_provider_attempts
  for each row execute function mammoth_p7_forbid_authority_mutation();

create function mammoth_p7_guard_capability()
returns trigger
language plpgsql
as $$
declare
  attempt record;
begin
  select model_work_id, provider, concrete_model, checkpoint,
         capability_manifest_digest into attempt
    from mammoth_p7_provider_attempts where id = new.provider_attempt_id;
  if attempt is null or attempt.model_work_id <> new.model_work_id
    or attempt.provider <> (new.manifest ->> 'provider')
    or attempt.concrete_model <> (new.manifest ->> 'concreteModel')
    or attempt.checkpoint <> (new.manifest ->> 'checkpoint')
    or attempt.capability_manifest_digest <> (new.manifest ->> 'manifestDigest')
  then
    raise exception 'P7 capability decision manifest mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_capability_guard
  before insert on mammoth_p7_capability_decisions
  for each row execute function mammoth_p7_guard_capability();

create function mammoth_p7_guard_artifact()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from mammoth_p7_provider_attempts
     where id = new.provider_attempt_id and model_work_id = new.model_work_id
  ) then
    raise exception 'P7 artifact provider-attempt mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_artifact_guard
  before insert on mammoth_p7_artifact_references
  for each row execute function mammoth_p7_guard_artifact();

create function mammoth_p7_guard_residue()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from mammoth_p7_artifact_references
     where id = new.artifact_id and model_work_id = new.model_work_id
       and provider_attempt_id = new.provider_attempt_id
  ) then
    raise exception 'P7 validation residue artifact mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_residue_guard
  before insert on mammoth_p7_validation_residue
  for each row execute function mammoth_p7_guard_residue();

create function mammoth_p7_guard_egress()
returns trigger
language plpgsql
as $$
declare
  work record;
  attempt record;
begin
  select reservation_id, authoritative_request into work
    from mammoth_p7_model_work where id = new.model_work_id;
  select model_work_id, provider, concrete_model, checkpoint, authoritative_request into attempt
    from mammoth_p7_provider_attempts where id = new.provider_attempt_id;
  if work is null or attempt is null
    or attempt.model_work_id <> new.model_work_id
    or new.reservation_id <> work.reservation_id
    or new.provider <> attempt.provider
    or new.concrete_model <> attempt.concrete_model
    or new.checkpoint <> attempt.checkpoint
    or new.prompt_digest <> attempt.authoritative_request #>> '{canonicalPromptDigest}'
  then
    raise exception 'P7 egress decision identity mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_egress_guard
  before insert on mammoth_p7_egress_decisions
  for each row execute function mammoth_p7_guard_egress();

create function mammoth_p7_guard_charge()
returns trigger
language plpgsql
as $$
declare
  work record;
  attempt record;
begin
  perform mammoth_p7_require_usage(new.usage, 'provider charge');
  select reservation_id, provider_effect_key into work
    from mammoth_p7_model_work where id = new.model_work_id;
  select model_work_id, provider, authoritative_request into attempt
    from mammoth_p7_provider_attempts where id = new.provider_attempt_id;
  if work is null or attempt is null
    or attempt.model_work_id <> new.model_work_id
    or new.reservation_id <> work.reservation_id
    or new.provider_effect_key <> attempt.authoritative_request #>> '{effect,idempotencyKey}'
    or new.provider <> attempt.provider
  then
    raise exception 'P7 provider charge identity mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_provider_charge_guard
  before insert on mammoth_p7_provider_charges
  for each row execute function mammoth_p7_guard_charge();

create function mammoth_p7_guard_settlement()
returns trigger
language plpgsql
as $$
declare
  charge record;
  work record;
  p6_settlement record;
begin
  perform mammoth_p7_require_usage(new.amount, 'budget settlement');
  select model_work_id, reservation_id, provider_attempt_id, usage into charge
    from mammoth_p7_provider_charges where id = new.provider_charge_id;
  select authoritative_request into work
    from mammoth_p7_provider_attempts where id = charge.provider_attempt_id;
  select reservation_id into p6_settlement
    from mammoth_p6_topology_budget_settlements where id = new.id;
  if charge is null or work is null
    or p6_settlement is null
    or p6_settlement.reservation_id <> new.reservation_id
    or charge.model_work_id <> new.model_work_id
    or charge.reservation_id <> new.reservation_id
    or charge.usage <> new.amount
    or (new.amount ->> 'inputTokens')::numeric > (work.authoritative_request #>> '{budget,inputTokens}')::numeric
    or (new.amount ->> 'outputTokens')::numeric > (work.authoritative_request #>> '{budget,outputTokens}')::numeric
    or (new.amount ->> 'currencyMicros')::numeric > (work.authoritative_request #>> '{budget,currencyMicros}')::numeric
    or (new.amount ->> 'wallClockMs')::numeric > (work.authoritative_request #>> '{budget,wallClockMs}')::numeric
  then
    raise exception 'P7 budget settlement exceeds or mismatches reservation';
  end if;
  if exists (
    select 1 from mammoth_p7_budget_releases where reservation_id = new.reservation_id
  ) then
    raise exception 'P7 released reservation cannot settle';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_budget_settlement_guard
  before insert on mammoth_p7_budget_settlements
  for each row execute function mammoth_p7_guard_settlement();

create function mammoth_p7_guard_release()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from mammoth_p6_topology_budget_releases
     where id = new.id and reservation_id = new.reservation_id
  ) then
    raise exception 'P7 budget release requires P6 authority';
  end if;
  if exists (
    select 1 from mammoth_p7_budget_settlements where reservation_id = new.reservation_id
  ) then
    raise exception 'P7 settled reservation cannot release';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_budget_release_guard
  before insert on mammoth_p7_budget_releases
  for each row execute function mammoth_p7_guard_release();

create function mammoth_p7_guard_cancellation()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from mammoth_p7_model_work
     where id = new.model_work_id and reservation_id = new.reservation_id
  ) then
    raise exception 'P7 cancellation reservation mismatch';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_cancellation_guard
  before insert on mammoth_p7_cancellation_fences
  for each row execute function mammoth_p7_guard_cancellation();

create function mammoth_p7_guard_reconstruction()
returns trigger
language plpgsql
as $$
declare
  work record;
begin
  select topology_attempt_id, reservation_id into work
    from mammoth_p7_model_work where id = new.model_work_id;
  if work is null
    or work.topology_attempt_id <> new.topology_attempt_id
    or work.reservation_id <> new.reservation_id
    or jsonb_typeof(new.artifact_ids) <> 'array'
    or exists (
      select 1 from jsonb_array_elements_text(new.artifact_ids)
        as artifact_ref(artifact_id)
       where not exists (
         select 1 from mammoth_p7_artifact_references artifact
          where artifact.id = artifact_ref.artifact_id
            and artifact.model_work_id = new.model_work_id
       )
    )
    or (new.provider_charge_id is not null and not exists (
      select 1 from mammoth_p7_provider_charges
       where id = new.provider_charge_id and model_work_id = new.model_work_id
    ))
    or (new.settlement_id is not null and not exists (
      select 1 from mammoth_p7_budget_settlements
       where id = new.settlement_id and model_work_id = new.model_work_id
    ))
    or (new.settlement_id is not null and new.provider_charge_id is null)
    or (new.settlement_id is not null and not exists (
      select 1 from mammoth_p7_budget_settlements
       where id = new.settlement_id
         and provider_charge_id = new.provider_charge_id
    ))
    or (new.cancellation_fence_id is not null and not exists (
      select 1 from mammoth_p7_cancellation_fences
       where id = new.cancellation_fence_id and model_work_id = new.model_work_id
    ))
  then
    raise exception 'P7 reconstruction link is incomplete';
  end if;
  return new;
end;
$$;

create trigger mammoth_p7_reconstruction_guard
  before insert on mammoth_p7_reconstruction_links
  for each row execute function mammoth_p7_guard_reconstruction();

create trigger mammoth_p7_capability_update_guard
  before update or delete on mammoth_p7_capability_decisions
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_egress_update_guard
  before update or delete on mammoth_p7_egress_decisions
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_artifacts_update_guard
  before update or delete on mammoth_p7_artifact_references
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_residue_update_guard
  before update or delete on mammoth_p7_validation_residue
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_charges_update_guard
  before update or delete on mammoth_p7_provider_charges
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_settlements_update_guard
  before update or delete on mammoth_p7_budget_settlements
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_releases_update_guard
  before update or delete on mammoth_p7_budget_releases
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_cancellations_update_guard
  before update or delete on mammoth_p7_cancellation_fences
  for each row execute function mammoth_p7_forbid_authority_mutation();
create trigger mammoth_p7_reconstruction_update_guard
  before update or delete on mammoth_p7_reconstruction_links
  for each row execute function mammoth_p7_forbid_authority_mutation();
`.trim(),
  }),
]);
