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
