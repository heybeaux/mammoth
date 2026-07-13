import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/work-queue';
import type {
  CellPlan,
  ModelProfileVersion,
  ResearchPosition,
} from '@mammoth/persistence';
import type {
  PostgresConnection,
  QueryResult,
  TransactionOptions,
} from '../src/driver.js';
import { PostgresAdapterError } from '../src/errors.js';
import { MigrationRunner } from '../src/migration-runner.js';
import { foundationMigrations } from '../src/migrations.js';
import {
  PostgresModelLineageRepository,
  PostgresResearchCellRepository,
} from '../src/research-cells.js';

type Row = Record<string, unknown>;

class RecordingDatabase implements PostgresConnection {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];
  handler: (sql: string, parameters: readonly unknown[]) => QueryResult<Row> =
    () => empty(1);

  query<R extends Row>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.calls.push({ sql, parameters });
    return Promise.resolve(this.handler(sql, parameters) as QueryResult<R>);
  }

  async transaction<T>(
    _options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

interface LedgerEntry {
  version: number;
  name: string;
  checksum: string;
  applied_at: string | null;
}

class FakeMigrationDatabase implements PostgresConnection {
  readonly ledger = new Map<number, LedgerEntry>();
  readonly executedMigrations: string[] = [];
  failSql: string | undefined;

  query<R extends Row>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    if (sql === this.failSql)
      return Promise.reject(new Error('injected migration interruption'));
    if (sql.startsWith('select version, name, checksum')) {
      const rows = [...this.ledger.values()].sort(
        (left, right) => left.version - right.version,
      );
      return Promise.resolve({
        rows: rows as unknown as readonly R[],
        rowCount: rows.length,
      });
    }
    if (sql.startsWith('insert into mammoth_schema_migrations')) {
      const version = Number(parameters[0]);
      this.ledger.set(version, {
        version,
        name: String(parameters[1]),
        checksum: String(parameters[2]),
        applied_at: null,
      });
      return Promise.resolve(empty(1) as QueryResult<R>);
    }
    if (sql.startsWith('update mammoth_schema_migrations')) {
      const entry = this.ledger.get(Number(parameters[0]));
      if (entry) entry.applied_at = String(parameters[1]);
      return Promise.resolve(empty(1) as QueryResult<R>);
    }
    if (
      sql.startsWith('create table if not exists mammoth_schema_migrations') ||
      sql.startsWith('select pg_advisory_')
    ) {
      return Promise.resolve(empty(1) as QueryResult<R>);
    }
    this.executedMigrations.push(sql);
    return Promise.resolve(empty(1) as QueryResult<R>);
  }

  async transaction<T>(
    _options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    const snapshot = new Map(
      [...this.ledger].map(([key, value]) => [key, { ...value }]),
    );
    try {
      return await operation(this);
    } catch (error) {
      this.ledger.clear();
      for (const [key, value] of snapshot) this.ledger.set(key, value);
      throw error;
    }
  }
}

const now = '2026-07-13T18:00:00.000Z';
const transaction = { statementTimeoutMs: 1_000, transactionTimeoutMs: 2_000 };
const criterionDigest = canonicalDigest({ criterion: 'pinned' });
const inputDigest = canonicalDigest({ input: 'cell' });

describe('research-cell migration', () => {
  it('adds forward-only P4 authority tables, constraints, triggers, and restart indexes', () => {
    const migration = foundationMigrations.find(({ version }) => version === 5);
    expect(migration?.name).toBe('research_cell_persistence');
    expect(migration?.sql).toContain('create table mammoth_model_profiles');
    expect(migration?.sql).toContain(
      'create table mammoth_model_profile_versions',
    );
    expect(migration?.sql).toContain('create table mammoth_cell_plans');
    expect(migration?.sql).toContain('create table mammoth_research_positions');
    expect(migration?.sql).toContain('create table mammoth_research_reviews');
    expect(migration?.sql).toContain('create table mammoth_dissent_reports');
    expect(migration?.sql).toContain(
      'create table mammoth_correlation_assessments',
    );
    expect(migration?.sql).toContain(
      'create table mammoth_rejected_audit_residue',
    );
    expect(migration?.sql).toContain('create table mammoth_cell_receipts');
    expect(migration?.sql).toContain(
      'unique (profile_id, provider, model_name, checkpoint)',
    );
    expect(migration?.sql).toContain(
      "criterion_digest text not null check (criterion_digest ~ '^sha256:",
    );
    expect(migration?.sql).toContain(
      'model profile cannot review its own position',
    );
    expect(migration?.sql).toContain(
      'immutable research-cell row cannot be changed',
    );
    expect(foundationMigrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('preserves P3 migration checksums while appending the P4 migration', () => {
    expect(foundationMigrations.slice(0, 4).map(({ name }) => name)).toEqual([
      'adapter_foundation',
      'transactional_epistemic_ledger',
      'durable_work_effects_outbox',
      'activity_effect_v2',
    ]);
    expect(foundationMigrations[4]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('installs P4 research-cell schema on an empty database and is repeatable after restart', async () => {
    const database = new FakeMigrationDatabase();
    const runner = new MigrationRunner(
      database,
      foundationMigrations,
      transaction,
    );

    const applied = await runner.migrate();
    const repeated = await runner.migrate();

    expect(applied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
    expect(repeated.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
    expect(database.executedMigrations).toEqual(
      foundationMigrations.map((migration) => migration.sql),
    );
  });

  it('upgrades from the current P3 schema by executing only the P4 migration', async () => {
    const database = new FakeMigrationDatabase();
    const p3Runner = new MigrationRunner(
      database,
      foundationMigrations.slice(0, 4),
      transaction,
    );
    await p3Runner.migrate();
    database.executedMigrations.length = 0;

    const p4Runner = new MigrationRunner(
      database,
      foundationMigrations,
      transaction,
    );
    const applied = await p4Runner.migrate();

    expect(applied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
    expect(database.executedMigrations).toEqual([foundationMigrations[4]?.sql]);
  });

  it('preserves interrupted P4 migration residue and fails closed on restart', async () => {
    const database = new FakeMigrationDatabase();
    await new MigrationRunner(
      database,
      foundationMigrations.slice(0, 4),
      transaction,
    ).migrate();
    database.failSql = foundationMigrations[4]?.sql;

    await expect(
      new MigrationRunner(
        database,
        foundationMigrations,
        transaction,
      ).migrate(),
    ).rejects.toMatchObject({ code: 'migration_failed' });

    database.failSql = undefined;
    await expect(
      new MigrationRunner(
        database,
        foundationMigrations,
        transaction,
      ).migrate(),
    ).rejects.toBeInstanceOf(PostgresAdapterError);
    await expect(
      new MigrationRunner(
        database,
        foundationMigrations,
        transaction,
      ).migrate(),
    ).rejects.toMatchObject({
      code: 'interrupted_migration',
      retryable: false,
    });
  });
});

describe('Postgres research-cell repositories', () => {
  it('upserts model profiles with optimistic revision and preserves aliases separately from versions', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('for update')) {
        return result({
          id: 'profile-1',
          provider: 'provider-a',
          canonical_name: 'new-name',
          family_id: 'family-a',
          active: true,
          aliases: ['old-name', 'new-name'],
          revision: 3,
          created_at: now,
          updated_at: now,
        });
      }
      if (sql.includes('group by profile.id')) {
        return result({
          id: 'profile-1',
          provider: 'provider-a',
          canonical_name: 'new-name',
          family_id: 'family-a',
          active: true,
          aliases: ['old-name', 'new-name'],
          revision: 4,
          created_at: now,
          updated_at: now,
        });
      }
      return empty(1);
    };

    const profile = await new PostgresModelLineageRepository(database, {
      transaction,
      now: () => now,
    }).upsertModelProfile({
      id: 'profile-1',
      provider: 'provider-a',
      canonicalName: 'new-name',
      familyId: 'family-a',
      active: true,
      aliases: ['old-name'],
      expectedRevision: 3,
    });

    const update = database.calls.find((call) =>
      call.sql.includes('revision = revision + 1'),
    );
    expect(update?.sql).toContain('where id = $1 and revision = $7');
    expect(
      database.calls.filter((call) =>
        call.sql.includes('insert into mammoth_model_profile_aliases'),
      ).length,
    ).toBe(2);
    expect(profile.aliases).toEqual(['old-name', 'new-name']);
  });

  it('appends immutable model-profile versions without rewriting historical lineage', async () => {
    const database = new RecordingDatabase();
    const version = modelVersion();

    await new PostgresModelLineageRepository(database, {
      transaction,
      now: () => now,
    }).appendModelProfileVersion(version);

    expect(database.calls[0]?.sql).toContain(
      'insert into mammoth_model_profile_versions',
    );
    expect(database.calls[0]?.sql).not.toContain('on conflict');
    expect(database.calls[0]?.parameters).toEqual(
      expect.arrayContaining([
        'version-1',
        'profile-1',
        1,
        'provider-a',
        'model-a',
        'checkpoint-a',
      ]),
    );
  });

  it('uses revision and fencing predicates when updating cell-plan state', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.startsWith('update mammoth_cell_plans')
        ? result({
            ...cellPlanRow(),
            status: 'completed',
            revision: 2,
            fencing_token: 6,
          })
        : empty(0);

    const plan = await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).updateCellPlanStatus({
      id: 'cell-plan-1',
      expectedRevision: 1,
      expectedFencingToken: 5,
      nextStatus: 'completed',
    });

    expect(database.calls[0]?.sql).toContain(
      'where id = $1 and revision = $2 and fencing_token = $3',
    );
    expect(plan).toMatchObject({
      status: 'completed',
      revision: 2,
      fencingToken: 6,
    });
  });

  it('rejects stale cell-plan revisions and fences', async () => {
    const database = new RecordingDatabase();
    database.handler = () => empty(0);

    await expect(
      new PostgresResearchCellRepository(database, {
        transaction,
        now: () => now,
      }).updateCellPlanStatus({
        id: 'cell-plan-1',
        expectedRevision: 1,
        expectedFencingToken: 5,
        nextStatus: 'failed',
      }),
    ).rejects.toMatchObject({ code: 'persistence_conflict', retryable: true });
  });

  it('rejects tampered position digests before durable insert', async () => {
    const database = new RecordingDatabase();

    await expect(
      new PostgresResearchCellRepository(database, {
        transaction,
        now: () => now,
      }).recordPosition({
        ...position(),
        body: { supportedByVoteOnly: true },
        positionDigest: canonicalDigest({ supportedByVoteOnly: false }),
      }),
    ).rejects.toMatchObject({
      code: 'persistence_integrity',
      retryable: false,
    });
    expect(database.calls).toHaveLength(0);
  });

  it('records immutable positions with claim and evidence IDs as typed references', async () => {
    const database = new RecordingDatabase();
    const pos = position();

    await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).recordPosition(pos);

    expect(database.calls[0]?.sql).toContain(
      'insert into mammoth_research_positions',
    );
    expect(database.calls[0]?.parameters).toEqual(
      expect.arrayContaining([
        'position-1',
        'cell-plan-1',
        'program-1',
        JSON.stringify(['claim-1']),
        JSON.stringify(['evidence-1']),
      ]),
    );
  });

  it('records rejected audit residue and receipts only after digest verification', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    });
    const residuePayload = {
      reason: 'criterion-drift',
      positionId: 'position-1',
    };
    const receiptPayload = {
      action: 'position-rejected',
      residueId: 'rejected-1',
    };

    await repository.recordRejectedResidue({
      id: 'rejected-1',
      programId: 'program-1',
      subjectType: 'position',
      subjectId: 'position-1',
      reasonCode: 'criterion-drift',
      policyVersion: 'admission@1',
      payloadDigest: canonicalDigest(residuePayload),
      payload: residuePayload,
      recordedAt: now,
    });
    await repository.recordReceipt({
      id: 'receipt-1',
      programId: 'program-1',
      subjectType: 'position',
      subjectId: 'position-1',
      workItemId: 'work-1',
      receiptKind: 'position-rejection',
      receiptDigest: canonicalDigest(receiptPayload),
      payload: receiptPayload,
      createdAt: now,
    });

    expect(database.calls[0]?.sql).toContain(
      'insert into mammoth_rejected_audit_residue',
    );
    expect(database.calls[1]?.sql).toContain(
      'insert into mammoth_cell_receipts',
    );
  });

  it('reconstructs restart state from authoritative Postgres rows instead of Temporal carry state', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('from mammoth_model_profiles profile')) {
        return result(modelProfileRow());
      }
      if (sql.includes('from mammoth_model_profile_versions version')) {
        return result(modelVersionRow());
      }
      if (sql.includes('from mammoth_correlation_assessments')) return empty(0);
      if (sql.includes('from mammoth_cell_plans')) return result(cellPlanRow());
      if (sql.includes('from mammoth_research_positions where program_id'))
        return result(positionRow());
      if (sql.includes('from mammoth_research_reviews where program_id'))
        return empty(0);
      if (sql.includes('from mammoth_dissent_reports where program_id'))
        return empty(0);
      if (sql.includes('from mammoth_rejected_audit_residue')) return empty(0);
      if (sql.includes('from mammoth_cell_receipts')) return empty(0);
      return empty(0);
    };

    const reconstructed = await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).reconstructProgram('program-1');

    expect(reconstructed).toMatchObject({
      programId: 'program-1',
      modelProfiles: [{ id: 'profile-1' }],
      modelProfileVersions: [{ id: 'version-1' }],
      cellPlans: [{ id: 'cell-plan-1' }],
      positions: [{ id: 'position-1' }],
    });
    expect(
      database.calls.every((call) => call.parameters[0] === 'program-1'),
    ).toBe(true);
  });
});

function modelVersion(): ModelProfileVersion {
  return {
    id: 'version-1',
    profileId: 'profile-1',
    profileRevision: 1,
    provider: 'provider-a',
    modelName: 'model-a',
    checkpoint: 'checkpoint-a',
    familyId: 'family-a',
    lineageStatus: 'known',
    trainingLineageIds: [],
    fineTuneLineageIds: [],
    sharedDerivationIds: [],
    locality: 'cloud',
    modalities: ['text'],
    contextWindow: 128_000,
    dataPolicyId: 'public-redacted-only',
    costProfileId: 'cost-a',
    declaredAt: now,
    metadata: {},
  };
}
function cellPlan(): CellPlan {
  return {
    id: 'cell-plan-1',
    programId: 'program-1',
    workItemId: 'work-1',
    criterionId: 'criterion-1',
    criterionDigest,
    planVersion: 'cell-plan@1',
    templateVersion: 'divergence@1',
    branchId: 'main',
    role: 'lateralist',
    inputDigest,
    outputContractVersion: 'position@1',
    status: 'planned',
    revision: 1,
    fencingToken: 5,
    createdAt: now,
    updatedAt: now,
  };
}
function position(): ResearchPosition {
  const body = { answer: 'candidate', claimIds: ['claim-1'] };
  return {
    id: 'position-1',
    cellPlanId: 'cell-plan-1',
    programId: 'program-1',
    workItemId: 'work-1',
    criterionId: 'criterion-1',
    criterionDigest,
    modelProfileId: 'profile-1',
    modelProfileVersionId: 'version-1',
    inputDigest,
    outputSchemaVersion: 'position@1',
    positionDigest: canonicalDigest(body),
    claimIds: ['claim-1'],
    evidenceIds: ['evidence-1'],
    hypothesisIds: ['hypothesis-1'],
    proposalRefs: ['proposal-1'],
    usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
    uncertaintyCode: null,
    failureCode: null,
    body,
    recordedAt: now,
  };
}
function modelProfileRow(): Row {
  return {
    id: 'profile-1',
    provider: 'provider-a',
    canonical_name: 'model-a',
    family_id: 'family-a',
    active: true,
    aliases: ['model-a', 'old-model-a'],
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}
function modelVersionRow(): Row {
  return {
    id: 'version-1',
    profile_id: 'profile-1',
    profile_revision: 1,
    provider: 'provider-a',
    model_name: 'model-a',
    checkpoint: 'checkpoint-a',
    family_id: 'family-a',
    lineage_status: 'known',
    training_lineage_ids: [],
    fine_tune_lineage_ids: [],
    shared_derivation_ids: [],
    locality: 'cloud',
    modalities: ['text'],
    context_window: 128_000,
    data_policy_id: 'public-redacted-only',
    cost_profile_id: 'cost-a',
    declared_at: now,
    metadata: {},
  };
}
function cellPlanRow(): Row {
  const plan = cellPlan();
  return {
    id: plan.id,
    program_id: plan.programId,
    work_item_id: plan.workItemId,
    criterion_id: plan.criterionId,
    criterion_digest: plan.criterionDigest,
    plan_version: plan.planVersion,
    template_version: plan.templateVersion,
    branch_id: plan.branchId,
    role: plan.role,
    input_digest: plan.inputDigest,
    output_contract_version: plan.outputContractVersion,
    status: plan.status,
    revision: plan.revision,
    fencing_token: plan.fencingToken,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
  };
}
function positionRow(): Row {
  const pos = position();
  return {
    id: pos.id,
    cell_plan_id: pos.cellPlanId,
    program_id: pos.programId,
    work_item_id: pos.workItemId,
    criterion_id: pos.criterionId,
    criterion_digest: pos.criterionDigest,
    model_profile_id: pos.modelProfileId,
    model_profile_version_id: pos.modelProfileVersionId,
    input_digest: pos.inputDigest,
    output_schema_version: pos.outputSchemaVersion,
    position_digest: pos.positionDigest,
    claim_ids: pos.claimIds,
    evidence_ids: pos.evidenceIds,
    hypothesis_ids: pos.hypothesisIds,
    proposal_refs: pos.proposalRefs,
    usage: pos.usage,
    uncertainty_code: pos.uncertaintyCode,
    failure_code: pos.failureCode,
    body: pos.body,
    recorded_at: pos.recordedAt,
  };
}
function result(row: Row): QueryResult<Row> {
  return { rows: [row], rowCount: 1 };
}
function empty(rowCount = 0): QueryResult<Row> {
  return { rows: [], rowCount };
}
