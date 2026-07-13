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
]);
