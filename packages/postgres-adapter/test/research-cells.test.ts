import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '@mammoth/work-queue';
import {
  RESEARCH_CELL_CONTRACT_VERSION,
  cellInputDigest,
  correlationAssessmentDigest,
  modelProfileVersionDigest,
  researchPositionDigest,
  researchReviewDigest,
  type CellInput,
  type CorrelationAssessment as DomainCorrelationAssessment,
  type ModelProfileVersion as DomainModelProfileVersion,
  type ResearchPosition as DomainResearchPosition,
  type ResearchReview as DomainResearchReview,
} from '@mammoth/domain';
import {
  P4_ADMISSION_POLICY_DIGEST,
  P4_ADMISSION_POLICY_VERSION,
  type CellPlanRecord,
  type CorrelationAssessmentRecord,
  type ModelProfileVersionRecord,
  type ResearchPositionRecord,
  type ResearchReviewRecord,
  type ReviewAssignmentRecord,
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
import { PostgresTopologyRepository } from '../src/p6-topology.js';

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

describe('research-cell migration', () => {
  it('adds forward-only P4 authority tables, constraints, triggers, and restart indexes', () => {
    const migration = foundationMigrations.find(({ version }) => version === 5);
    expect(migration?.name).toBe('research_cell_persistence');
    expect(migration?.sql).toContain('create table mammoth_model_profiles');
    expect(migration?.sql).toContain(
      'create table mammoth_model_profile_versions',
    );
    expect(migration?.sql).toContain(
      'create table mammoth_model_lineage_edges',
    );
    expect(migration?.sql).toContain('create table mammoth_cell_plans');
    expect(migration?.sql).toContain('create table mammoth_research_positions');
    expect(migration?.sql).toContain('create table mammoth_review_assignments');
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
    expect(migration?.sql).toContain(
      "admission_decision text not null check (admission_decision = 'admitted')",
    );
    expect(migration?.sql).toContain(
      `admission_policy_version text not null check (admission_policy_version = '${P4_ADMISSION_POLICY_VERSION}')`,
    );
    expect(migration?.sql).toContain(
      `admission_policy_digest text not null check (admission_policy_digest = '${P4_ADMISSION_POLICY_DIGEST}')`,
    );
    expect(migration?.sql).toContain(
      "decision text not null check (decision = 'rejected')",
    );
    expect(migration?.sql).toContain(
      'parent_version_id text not null references mammoth_model_profile_versions(id)',
    );
    expect(migration?.sql).toContain('position cell-plan metadata mismatch');
    expect(migration?.sql).toContain(
      "assignment_reviewer_agent <> new.authoritative_contract->>'reviewerAgentId'",
    );
    expect(foundationMigrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('appends the forward-only P6 migration after the P5 migration', () => {
    expect(foundationMigrations.slice(0, 4).map(({ name }) => name)).toEqual([
      'adapter_foundation',
      'transactional_epistemic_ledger',
      'durable_work_effects_outbox',
      'activity_effect_v2',
    ]);
    expect(foundationMigrations[4]?.name).toBe('research_cell_persistence');
    expect(foundationMigrations[5]?.name).toBe('p5_isolated_divergence');
    expect(foundationMigrations[6]?.name).toBe('p6_research_topology');
    expect(foundationMigrations[4]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(foundationMigrations[5]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(foundationMigrations[6]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(foundationMigrations[5]?.sql).toContain(
      'create table mammoth_p5_isolation_commits',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'create table mammoth_p5_budget_reservations',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'create table mammoth_p5_cancellation_receipts',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      "isolation_protocol_version text not null check (isolation_protocol_version = '1.0.0')",
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'P5 isolation commit metadata mismatch',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'P5 reveal audit sequence must follow commit sequence',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'P5 sanitized context contains forbidden attribution',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'P5 budget reservation transition is invalid',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'P5 budget settlement exceeds reservation ceiling',
    );
    expect(foundationMigrations[5]?.sql).toContain(
      'P5 cancellation amount exceeds reservation ceiling',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'create table mammoth_p6_topology_plans',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'create table mammoth_p6_topology_budget_reservations',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'create table mammoth_p6_topology_scheduler_snapshots',
    );
    expect(foundationMigrations[6]?.sql).toContain('idle_no_ready_work');
    expect(foundationMigrations[6]?.sql).toContain(
      'P6 topology budget settlement exceeds reservation ceiling',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'P6 topology budget release cannot follow settlement',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'P6 topology cancellation amount exceeds reservation ceiling',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'P6 topology authority rows are immutable',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'P6 topology authority rows cannot be deleted',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'mammoth_p6_topology_budget_settlements_update_guard',
    );
    expect(foundationMigrations[6]?.sql).toContain(
      'mammoth_p6_topology_cancellation_receipts_delete_guard',
    );
  });

  it('fails P6 budget settlement when no reservation transition occurs', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('insert into mammoth_p6_topology_budget_settlements'))
        return result({
          id: 'settlement-a',
          stable_identity: 'settlement:stable',
          reservation_id: 'reservation-a',
          amount: { costUsd: 1, tokens: 1, durationMs: 1 },
          settled_at: '2026-07-14T00:00:00.000Z',
          receipt_id: 'receipt-settlement',
        });
      if (sql.includes('update mammoth_p6_topology_budget_reservations'))
        return empty(0);
      return empty(1);
    };
    const repo = new PostgresTopologyRepository(database, { transaction });

    await expect(
      repo.settleBudget({
        id: 'settlement-a',
        stableIdentity: 'settlement:stable',
        reservationId: 'reservation-a',
        amount: { costUsd: 1, tokens: 1, durationMs: 1 },
        settledAt: '2026-07-14T00:00:00.000Z',
        receiptId: 'receipt-settlement',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_migration_set',
      retryable: false,
    });
  });

  it('rejects P6 duplicate settlement stable identity with different payload', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('insert into mammoth_p6_topology_budget_settlements'))
        return empty(0);
      if (
        sql.includes(
          'select * from mammoth_p6_topology_budget_settlements where stable_identity',
        )
      )
        return result({
          id: 'settlement-a',
          stable_identity: 'settlement:stable',
          reservation_id: 'reservation-a',
          amount: { costUsd: 2, tokens: 1, durationMs: 1 },
          settled_at: '2026-07-14T00:00:00.000Z',
          receipt_id: 'receipt-settlement',
        });
      return empty(1);
    };
    const repo = new PostgresTopologyRepository(database, { transaction });

    await expect(
      repo.settleBudget({
        id: 'settlement-a',
        stableIdentity: 'settlement:stable',
        reservationId: 'reservation-a',
        amount: { costUsd: 1, tokens: 1, durationMs: 1 },
        settledAt: '2026-07-14T00:00:00.000Z',
        receiptId: 'receipt-settlement',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_migration_set',
      retryable: false,
    });
  });

  it('installs P6 research-topology schema on an empty database and is repeatable after restart', async () => {
    const database = new FakeMigrationDatabase();
    const runner = new MigrationRunner(
      database,
      foundationMigrations,
      transaction,
    );

    const applied = await runner.migrate();
    const repeated = await runner.migrate();

    expect(applied.map((entry) => entry.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(repeated.map((entry) => entry.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(database.executedMigrations).toEqual(
      foundationMigrations.map((migration) => migration.sql),
    );
  });

  it('upgrades from the current P3 schema by executing P4, P5, then P6 migrations', async () => {
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

    expect(applied.map((entry) => entry.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(database.executedMigrations).toEqual([
      foundationMigrations[4]?.sql,
      foundationMigrations[5]?.sql,
      foundationMigrations[6]?.sql,
    ]);
  });

  it('upgrades from the P5 schema by executing only the P6 migration', async () => {
    const database = new FakeMigrationDatabase();
    const p5Runner = new MigrationRunner(
      database,
      foundationMigrations.slice(0, 6),
      transaction,
    );
    await p5Runner.migrate();
    database.executedMigrations.length = 0;

    const p6Runner = new MigrationRunner(
      database,
      foundationMigrations,
      transaction,
    );
    const applied = await p6Runner.migrate();

    expect(applied.map((entry) => entry.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(database.executedMigrations).toEqual([foundationMigrations[6]?.sql]);
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
          authoritative_contract: {
            id: 'profile-1',
            provider: 'provider-a',
            family: 'family-a',
            displayName: 'new-name',
          },
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
          authoritative_contract: {
            id: 'profile-1',
            provider: 'provider-a',
            family: 'family-a',
            displayName: 'new-name',
          },
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
      contract: {
        id: 'profile-1',
        provider: 'provider-a',
        family: 'family-a',
        displayName: 'new-name',
      },
      active: true,
      aliases: ['old-name'],
      expectedRevision: 3,
    });

    const update = database.calls.find((call) =>
      call.sql.includes('revision = revision + 1'),
    );
    expect(update?.sql).toContain('where id = $1 and revision = $8');
    expect(
      database.calls.filter((call) =>
        call.sql.includes('insert into mammoth_model_profile_aliases'),
      ).length,
    ).toBe(2);
    expect(profile.aliases).toEqual(['old-name', 'new-name']);
  });

  it('appends immutable model-profile versions without rewriting historical lineage', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.includes('with recursive ancestry') ? empty(0) : empty(1);
    const version = modelVersion();

    await new PostgresModelLineageRepository(database, {
      transaction,
      now: () => now,
    }).appendModelProfileVersion(version);

    expect(database.calls[0]?.sql).toContain(
      'insert into mammoth_model_profile_versions',
    );
    expect(database.calls[0]?.sql).toContain(
      'on conflict (id) do nothing returning id',
    );
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

  it('persists typed lineage edges only after every parent exists', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('where id = any')) return result({ id: 'version-1' });
      if (sql.includes('with recursive ancestry')) return empty(0);
      return empty(1);
    };

    await new PostgresModelLineageRepository(database, {
      transaction,
      now: () => now,
    }).appendModelProfileVersion(childModelVersion(['version-1']));

    const edge = database.calls.find((call) =>
      call.sql.includes('insert into mammoth_model_lineage_edges'),
    );
    expect(edge?.parameters).toEqual([
      'version-child',
      'version-1',
      'parent',
      now,
    ]);
  });

  it('fails the append transaction on dangling or cyclic model lineage', async () => {
    const dangling = new RecordingDatabase();
    dangling.handler = (sql) =>
      sql.includes('where id = any') ? empty(0) : empty(1);
    await expect(
      new PostgresModelLineageRepository(dangling, {
        transaction,
        now: () => now,
      }).appendModelProfileVersion(childModelVersion(['missing'])),
    ).rejects.toThrow(/dangling model lineage/);

    const cyclic = new RecordingDatabase();
    cyclic.handler = (sql) => {
      if (sql.includes('where id = any')) return result({ id: 'version-1' });
      if (sql.includes('with recursive ancestry')) return result({ cycle: 1 });
      return empty(1);
    };
    await expect(
      new PostgresModelLineageRepository(cyclic, {
        transaction,
        now: () => now,
      }).appendModelProfileVersion(childModelVersion(['version-1'])),
    ).rejects.toThrow(/cyclic model lineage/);
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

  it('rejects position metadata that drifts from its domain contract before durable insert', async () => {
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
    ).rejects.toThrow(/drifts from domain contract/);
    expect(database.calls).toHaveLength(0);
  });

  it('rejects duplicated position references and admission provenance that drift', async () => {
    const database = new RecordingDatabase();
    const repository = new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    });
    await expect(
      repository.recordPosition({
        ...position(),
        claimIds: ['claim-not-in-contract'],
      }),
    ).rejects.toThrow(/drifts from domain contract/);
    await expect(
      repository.recordPosition({
        ...position(),
        admission: {
          ...position().admission,
          subjectDigest: canonicalDigest({ wrong: 'subject' }),
        },
      }),
    ).rejects.toThrow(/drifts from domain contract/);
    await expect(
      repository.recordPosition({
        ...position(),
        admission: {
          ...position().admission,
          policyVersion: 'caller-authored',
        },
      } as unknown as ResearchPositionRecord),
    ).rejects.toThrow();
    expect(database.calls).toHaveLength(0);
  });

  it('records immutable positions with claim and evidence IDs as typed references', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('from mammoth_cell_plans where id'))
        return result(cellPlanRow());
      if (sql.includes('with recursive lineage_closure'))
        return result(modelVersionRow());
      return empty(1);
    };
    const pos = position();

    await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).recordPosition(pos);

    const insert = database.calls.find((call) =>
      call.sql.includes('insert into mammoth_research_positions'),
    );
    expect(insert?.sql).toContain('insert into mammoth_research_positions');
    expect(insert?.parameters).toEqual(
      expect.arrayContaining([
        'position-1',
        'cell-plan-1',
        'program-1',
        JSON.stringify(['claim-1']),
        JSON.stringify(['evidence-1']),
      ]),
    );
  });

  it('persists deterministic residue when a position proposes references outside the locked plan input', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('from mammoth_cell_plans where id'))
        return result(cellPlanRow());
      if (sql.includes('with recursive lineage_closure'))
        return result(modelVersionRow());
      return empty(1);
    };
    const original = positionContract();
    const base: DomainResearchPosition = {
      ...original,
      claimIds: ['claim-outside-plan'],
      proposalRefs: [{ kind: 'claim', id: 'claim-outside-plan' }],
      canonicalDigest: canonicalDigest('placeholder'),
    };
    const contract = {
      ...base,
      canonicalDigest: researchPositionDigest(base),
    };
    const candidate: ResearchPositionRecord = {
      ...position(),
      contract,
      admission: {
        ...position().admission,
        subjectDigest: contract.canonicalDigest,
      },
      positionDigest: contract.canonicalDigest,
      claimIds: contract.claimIds,
      proposalRefs: contract.proposalRefs,
      body: contract,
    };
    const first = await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).recordPosition(candidate);
    expect(first.decision).toBe('rejected');
    if (first.decision !== 'rejected')
      throw new Error('expected position rejection residue');
    expect(first.residue.subjectId).toBe(candidate.id);
    expect(first.residue.reasonCodes).toContain('missing_claim_ref');
    expect(
      database.calls.some((call) =>
        call.sql.includes('insert into mammoth_rejected_audit_residue'),
      ),
    ).toBe(true);
    expect(
      database.calls.some((call) =>
        call.sql.includes('insert into mammoth_research_positions'),
      ),
    ).toBe(false);
  });

  it('replays identical immutable writes and rejects conflicting reuse of an ID', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('from mammoth_cell_plans where id'))
        return result(cellPlanRow());
      if (sql.includes('with recursive lineage_closure'))
        return result(modelVersionRow());
      if (sql.includes('insert into mammoth_research_positions'))
        return empty(0);
      if (sql.includes('select * from mammoth_research_positions where id'))
        return result(positionRow());
      return empty(1);
    };
    const repository = new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    });
    await expect(repository.recordPosition(position())).resolves.toEqual({
      decision: 'admitted',
      record: position(),
    });
    await expect(
      repository.recordPosition({
        ...position(),
        admission: {
          ...position().admission,
          decidedAt: '2026-07-13T18:01:00.000Z',
        },
      }),
    ).rejects.toThrow(/conflicts with existing content/);
  });

  it('persists immutable blind-review assignments before reviews', async () => {
    const database = new RecordingDatabase();
    const assignment = reviewAssignment();

    await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).recordReviewAssignment(assignment);

    expect(database.calls[0]?.sql).toContain(
      'insert into mammoth_review_assignments',
    );
    expect(database.calls[0]?.parameters).toEqual(
      expect.arrayContaining([
        assignment.id,
        assignment.targetPositionId,
        assignment.reviewerModelProfileVersionId,
        assignment.assignmentDigest,
      ]),
    );
  });

  it('writes every admitted review envelope field with stable SQL parameters', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) => {
      if (sql.includes('from mammoth_review_assignments where id'))
        return result(reviewAssignmentRow());
      if (sql.includes('from mammoth_research_positions where id'))
        return result(positionRow());
      if (sql.includes('from mammoth_cell_plans where id'))
        return result(cellPlanRow());
      if (sql.includes('with recursive lineage_closure'))
        return {
          rows: [modelVersionRow(), reviewerModelVersionRow()],
          rowCount: 2,
        };
      return empty(1);
    };
    const review = researchReview();

    await new PostgresResearchCellRepository(database, {
      transaction,
      now: () => now,
    }).recordReview(review);

    const insert = database.calls.find((call) =>
      call.sql.includes('insert into mammoth_research_reviews'),
    );
    expect(insert?.sql).toContain('insert into mammoth_research_reviews');
    expect(insert?.sql).toContain('$31::jsonb');
    expect(insert?.parameters).toHaveLength(31);
    expect(insert?.parameters).toEqual(
      expect.arrayContaining([
        review.assignmentId,
        review.admission.policyDigest,
        JSON.stringify(review.admission.reasonCodes),
      ]),
    );
  });

  it('rejects correlated reviews and caller-authored independent correlation claims', async () => {
    const reviewDatabase = new RecordingDatabase();
    reviewDatabase.handler = (sql) => {
      if (sql.includes('from mammoth_review_assignments where id'))
        return result(reviewAssignmentRow());
      if (sql.includes('from mammoth_research_positions where id'))
        return result(positionRow());
      if (sql.includes('from mammoth_cell_plans where id'))
        return result(cellPlanRow());
      if (sql.includes('with recursive lineage_closure'))
        return {
          rows: [modelVersionRow(), correlatedReviewerModelVersionRow()],
          rowCount: 2,
        };
      return empty(1);
    };
    const rejectedReview = await new PostgresResearchCellRepository(
      reviewDatabase,
      {
        transaction,
        now: () => now,
      },
    ).recordReview(researchReview());
    expect(rejectedReview.decision).toBe('rejected');
    if (rejectedReview.decision !== 'rejected')
      throw new Error('expected review rejection residue');
    expect(rejectedReview.residue.reasonCodes).toContain('correlated_review');
    expect(
      reviewDatabase.calls.some((call) =>
        call.sql.includes('insert into mammoth_research_reviews'),
      ),
    ).toBe(false);
    expect(
      reviewDatabase.calls.some((call) =>
        call.sql.includes('insert into mammoth_rejected_audit_residue'),
      ),
    ).toBe(true);

    const correlationDatabase = new RecordingDatabase();
    correlationDatabase.handler = (sql) =>
      sql.includes('with recursive lineage_closure')
        ? {
            rows: [modelVersionRow(), correlatedReviewerModelVersionRow()],
            rowCount: 2,
          }
        : empty(1);
    await expect(
      new PostgresResearchCellRepository(correlationDatabase, {
        transaction,
        now: () => now,
      }).recordCorrelation(fakeIndependentCorrelation()),
    ).rejects.toThrow(/correlation_policy_drift/);
  });

  it('requires an expected revision for model-profile updates and rejects duplicate lineage parents', async () => {
    const database = new RecordingDatabase();
    database.handler = (sql) =>
      sql.includes('select * from mammoth_model_profiles')
        ? result(modelProfileRow())
        : empty(1);
    const lineage = new PostgresModelLineageRepository(database, {
      transaction,
      now: () => now,
    });
    await expect(
      lineage.upsertModelProfile({
        id: 'profile-1',
        provider: 'provider-a',
        canonicalName: 'model-a',
        familyId: 'family-a',
        active: true,
        aliases: [],
        contract: modelProfileRow().authoritative_contract as never,
      }),
    ).rejects.toThrow(/requires expected revision/);
    await expect(
      lineage.appendModelProfileVersion(
        childModelVersion(['version-1', 'version-1']),
      ),
    ).rejects.toThrow(/duplicate model lineage parent/);
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
      policyDigest: canonicalDigest({ policy: 'admission@1' }),
      reasonCodes: ['criterion-drift'],
      decision: 'rejected',
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
    expect(database.calls[0]?.sql).toContain('repeatable read read only');
    expect(
      database.calls
        .slice(1, 11)
        .every((call) => call.parameters[0] === 'program-1'),
    ).toBe(true);
  });
});

function modelVersionContract(): DomainModelProfileVersion {
  const base: DomainModelProfileVersion = {
    id: 'version-1',
    profileId: 'profile-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    provider: 'provider-a',
    providerModelId: 'model-a',
    family: 'family-a',
    checkpoint: 'checkpoint-a',
    contextWindow: 128_000,
    modalities: ['text'],
    locality: 'cloud',
    dataPolicyId: 'public-redacted-only',
    costProfileId: 'cost-a',
    lineage: {
      kind: 'known',
      trainingLineageIds: [],
      fineTuneLineageIds: [],
      sharedDerivationIds: [],
      parentVersionIds: [],
    },
    immutableDigest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    recordedAt: now,
  };
  return { ...base, immutableDigest: modelProfileVersionDigest(base) };
}
function modelVersion(): ModelProfileVersionRecord {
  return {
    contract: modelVersionContract(),
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
function childModelVersion(
  parentVersionIds: readonly string[],
): ModelProfileVersionRecord {
  const parent = modelVersion();
  const base: DomainModelProfileVersion = {
    ...parent.contract,
    id: 'version-child',
    providerModelId: 'model-child',
    checkpoint: 'checkpoint-child',
    lineage: {
      ...parent.contract.lineage,
      parentVersionIds: [...parentVersionIds],
    },
    immutableDigest: canonicalDigest('placeholder'),
  };
  const contract = {
    ...base,
    immutableDigest: modelProfileVersionDigest(base),
  };
  return {
    ...parent,
    contract,
    id: contract.id,
    profileRevision: 2,
    modelName: contract.providerModelId,
    checkpoint: contract.checkpoint,
  };
}
function reviewAssignment(): ReviewAssignmentRecord {
  const contract: ReviewAssignmentRecord['contract'] = {
    id: 'assignment-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-1',
    workItemId: 'work-review-1',
    targetPositionId: 'position-1',
    reviewerAgentId: 'agent-reviewer',
    reviewerModelProfileVersionId: 'version-reviewer',
    reviewerRole: 'falsifier',
    targetAuthorAgentId: 'agent-1',
    targetModelProfileVersionId: 'version-1',
    targetRole: 'lateralist',
    criterionRef: cellPlan().contract.criterionRef,
    blind: true,
    assignedAt: now,
  };
  return {
    contract,
    id: contract.id,
    programId: contract.programId,
    workItemId: contract.workItemId,
    targetPositionId: contract.targetPositionId,
    reviewerAgentId: contract.reviewerAgentId,
    reviewerModelProfileVersionId: contract.reviewerModelProfileVersionId,
    reviewerRole: contract.reviewerRole,
    targetAuthorAgentId: contract.targetAuthorAgentId,
    targetModelProfileVersionId: contract.targetModelProfileVersionId,
    targetRole: contract.targetRole,
    criterionId: contract.criterionRef.criterionId,
    criterionDigest: contract.criterionRef.criterionDigest,
    blind: contract.blind,
    assignmentDigest: canonicalDigest(contract),
    recordedAt: contract.assignedAt,
  };
}
function researchReview(): ResearchReviewRecord {
  const assignment = reviewAssignment();
  const base: DomainResearchReview = {
    id: 'review-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    assignmentId: assignment.id,
    programId: assignment.programId,
    workItemId: assignment.workItemId,
    targetPositionId: assignment.targetPositionId,
    reviewerAgentId: assignment.reviewerAgentId,
    reviewerModelProfileVersionId: assignment.reviewerModelProfileVersionId,
    reviewerRole: assignment.reviewerRole,
    criterionRef: assignment.contract.criterionRef,
    inputDigest: cellPlan().inputDigest,
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    verdict: 'reject',
    reasonCodes: ['unsupported-claim'],
    checkedClaimIds: ['claim-1'],
    checkedEvidenceIds: ['evidence-1'],
    checkedHypothesisIds: ['hypothesis-1'],
    checkedArtifactIds: [],
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      costUsd: 0.02,
      latencyMs: 20,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest: canonicalDigest('placeholder'),
    createdAt: now,
  };
  const contract = { ...base, canonicalDigest: researchReviewDigest(base) };
  return {
    contract,
    admission: {
      decision: 'admitted',
      policyVersion: P4_ADMISSION_POLICY_VERSION,
      policyDigest: P4_ADMISSION_POLICY_DIGEST,
      subjectDigest: contract.canonicalDigest,
      reasonCodes: ['admitted'],
      decidedAt: now,
    },
    id: contract.id,
    assignmentId: contract.assignmentId,
    positionId: contract.targetPositionId,
    cellPlanId: 'cell-plan-1',
    programId: contract.programId,
    workItemId: contract.workItemId,
    criterionId: contract.criterionRef.criterionId,
    criterionDigest: contract.criterionRef.criterionDigest,
    modelProfileId: 'profile-reviewer',
    modelProfileVersionId: contract.reviewerModelProfileVersionId,
    reviewerRole: contract.reviewerRole,
    inputDigest: contract.inputDigest,
    outputSchemaVersion: contract.outputSchemaVersion,
    reviewDigest: contract.canonicalDigest,
    verdict: contract.verdict,
    claimIds: contract.checkedClaimIds,
    evidenceIds: contract.checkedEvidenceIds,
    hypothesisIds: contract.checkedHypothesisIds,
    usage: contract.usage,
    uncertaintyCodes: contract.uncertaintyCodes,
    failureCodes: contract.failureCodes,
    reasons: contract.reasonCodes,
    body: contract,
    recordedAt: contract.createdAt,
  };
}
function cellPlan(): CellPlanRecord {
  const input: CellInput = {
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    claimIds: ['claim-1'],
    evidenceIds: ['evidence-1'],
    hypothesisIds: ['hypothesis-1'],
    artifactIds: [],
  };
  const authoritativeInputDigest = cellInputDigest(input);
  return {
    contract: {
      id: 'cell-plan-1',
      schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      programId: 'program-1',
      workItemId: 'work-1',
      templateId: 'template-divergence',
      templateVersion: 1,
      criterionRef: {
        criterionId: 'criterion-1',
        criterionVersion: 1,
        criterionDigest,
        branchId: 'main',
      },
      branchId: 'main',
      input,
      inputDigest: authoritativeInputDigest,
      outputContract: {
        kind: 'positions',
        minimumCount: 1,
        schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
      },
      plannedAt: now,
    },
    id: 'cell-plan-1',
    programId: 'program-1',
    workItemId: 'work-1',
    criterionId: 'criterion-1',
    criterionDigest,
    planVersion: 'cell-plan@1',
    templateVersion: '1',
    branchId: 'main',
    role: 'lateralist',
    inputDigest: authoritativeInputDigest,
    outputContractVersion: RESEARCH_CELL_CONTRACT_VERSION,
    status: 'planned',
    revision: 1,
    fencingToken: 5,
    createdAt: now,
    updatedAt: now,
  };
}
function positionContract(): DomainResearchPosition {
  const plan = cellPlan().contract;
  const base: DomainResearchPosition = {
    id: 'position-1',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    programId: 'program-1',
    cellPlanId: 'cell-plan-1',
    workItemId: 'work-1',
    authorAgentId: 'agent-1',
    role: 'lateralist',
    criterionRef: plan.criterionRef,
    modelProfileVersionId: 'version-1',
    inputDigest: plan.inputDigest,
    outputSchemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    answer: 'candidate',
    claimIds: ['claim-1'],
    evidenceIds: ['evidence-1'],
    hypothesisIds: ['hypothesis-1'],
    artifactIds: [],
    proposalRefs: [{ kind: 'claim', id: 'claim-1' }],
    assumptions: [],
    dissent: [],
    proposedFalsifiers: [],
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.01,
      latencyMs: 10,
    },
    uncertaintyCodes: [],
    failureCodes: [],
    receiptRefs: [],
    canonicalDigest:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: now,
  };
  return { ...base, canonicalDigest: researchPositionDigest(base) };
}
function position(): ResearchPositionRecord {
  const contract = positionContract();
  return {
    contract,
    admission: {
      decision: 'admitted',
      policyVersion: P4_ADMISSION_POLICY_VERSION,
      policyDigest: P4_ADMISSION_POLICY_DIGEST,
      subjectDigest: contract.canonicalDigest,
      reasonCodes: ['admitted'],
      decidedAt: now,
    },
    id: 'position-1',
    cellPlanId: 'cell-plan-1',
    programId: 'program-1',
    workItemId: 'work-1',
    criterionId: 'criterion-1',
    criterionDigest,
    modelProfileId: 'profile-1',
    modelProfileVersionId: 'version-1',
    inputDigest: contract.inputDigest,
    outputSchemaVersion: contract.outputSchemaVersion,
    positionDigest: contract.canonicalDigest,
    claimIds: ['claim-1'],
    evidenceIds: ['evidence-1'],
    hypothesisIds: ['hypothesis-1'],
    proposalRefs: contract.proposalRefs,
    usage: contract.usage,
    uncertaintyCodes: contract.uncertaintyCodes,
    failureCodes: contract.failureCodes,
    body: contract,
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
    authoritative_contract: {
      id: 'profile-1',
      provider: 'provider-a',
      family: 'family-a',
      displayName: 'model-a',
    },
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
    authoritative_contract: modelVersionContract(),
  };
}
function reviewerModelVersionRow(): Row {
  const parent = modelVersionContract();
  const base: DomainModelProfileVersion = {
    ...parent,
    id: 'version-reviewer',
    profileId: 'profile-reviewer',
    provider: 'provider-reviewer',
    providerModelId: 'model-reviewer',
    family: 'family-reviewer',
    checkpoint: 'checkpoint-reviewer',
    immutableDigest: canonicalDigest('placeholder'),
  };
  const contract = {
    ...base,
    immutableDigest: modelProfileVersionDigest(base),
  };
  return {
    ...modelVersionRow(),
    id: contract.id,
    profile_id: contract.profileId,
    provider: contract.provider,
    model_name: contract.providerModelId,
    family_id: contract.family,
    checkpoint: contract.checkpoint,
    authoritative_contract: contract,
  };
}
function correlatedReviewerModelVersionRow(): Row {
  const row = reviewerModelVersionRow();
  const original = row.authoritative_contract as DomainModelProfileVersion;
  const base: DomainModelProfileVersion = {
    ...original,
    family: 'family-a',
    checkpoint: 'checkpoint-a',
    immutableDigest: canonicalDigest('placeholder'),
  };
  const contract = {
    ...base,
    immutableDigest: modelProfileVersionDigest(base),
  };
  return {
    ...row,
    family_id: contract.family,
    checkpoint: contract.checkpoint,
    authoritative_contract: contract,
  };
}
function fakeIndependentCorrelation(): CorrelationAssessmentRecord {
  const base: DomainCorrelationAssessment = {
    id: 'correlation-fake-independent',
    schemaVersion: RESEARCH_CELL_CONTRACT_VERSION,
    policyVersion: '1.0.0',
    subjectModelProfileVersionId: 'version-1',
    candidateModelProfileVersionId: 'version-reviewer',
    independent: true,
    correlationScore: 0,
    reasonCodes: ['different_known_family'],
    assessedAt: now,
    canonicalDigest: canonicalDigest('placeholder'),
  };
  const contract = {
    ...base,
    canonicalDigest: correlationAssessmentDigest(base),
  };
  return {
    contract,
    id: contract.id,
    leftModelProfileVersionId: contract.subjectModelProfileVersionId,
    rightModelProfileVersionId: contract.candidateModelProfileVersionId,
    policyVersion: contract.policyVersion,
    correlationScore: contract.correlationScore,
    independenceVerdict: 'independent',
    reasons: contract.reasonCodes,
    assessmentDigest: contract.canonicalDigest,
    assessedAt: contract.assessedAt,
  };
}
function reviewAssignmentRow(): Row {
  const assignment = reviewAssignment();
  return {
    id: assignment.id,
    program_id: assignment.programId,
    work_item_id: assignment.workItemId,
    target_position_id: assignment.targetPositionId,
    reviewer_agent_id: assignment.reviewerAgentId,
    reviewer_model_profile_version_id: assignment.reviewerModelProfileVersionId,
    reviewer_role: assignment.reviewerRole,
    target_author_agent_id: assignment.targetAuthorAgentId,
    target_model_profile_version_id: assignment.targetModelProfileVersionId,
    target_role: assignment.targetRole,
    criterion_id: assignment.criterionId,
    criterion_digest: assignment.criterionDigest,
    blind: assignment.blind,
    assignment_digest: assignment.assignmentDigest,
    authoritative_contract: assignment.contract,
    recorded_at: assignment.recordedAt,
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
    authoritative_contract: plan.contract,
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
    uncertainty_codes: pos.uncertaintyCodes,
    failure_codes: pos.failureCodes,
    body: pos.body,
    admission_decision: pos.admission.decision,
    admission_policy_version: pos.admission.policyVersion,
    admission_policy_digest: pos.admission.policyDigest,
    admission_subject_digest: pos.admission.subjectDigest,
    admission_reason_codes: pos.admission.reasonCodes,
    admission_decided_at: pos.admission.decidedAt,
    recorded_at: pos.recordedAt,
    authoritative_contract: pos.contract,
  };
}
function result(row: Row): QueryResult<Row> {
  return { rows: [row], rowCount: 1 };
}
function empty(rowCount = 0): QueryResult<Row> {
  return { rows: [], rowCount };
}
