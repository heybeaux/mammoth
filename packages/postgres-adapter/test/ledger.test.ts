import { describe, expect, it } from 'vitest';
import type {
  PostgresConnection,
  QueryResult,
  TransactionOptions,
} from '../src/driver.js';
import type { LedgerState } from '@mammoth/persistence';
import { PostgresEpistemicLedger } from '../src/ledger.js';

class FakeDatabase implements PostgresConnection {
  data = {
    state: emptyState(),
    revisions: [] as unknown[],
    audits: [] as unknown[],
    outbox: [] as unknown[],
  };
  #queue: Promise<void> = Promise.resolve();
  failAudit = false;
  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    await Promise.resolve();
    if (sql.startsWith('select revision, state'))
      return result<Row>({
        revision: this.data.state.revision,
        state: structuredClone(this.data.state),
      });
    if (sql.startsWith('update mammoth_epistemic_ledger'))
      this.data.state = JSON.parse(String(parameters[1])) as LedgerState;
    else if (sql.startsWith('insert into mammoth_epistemic_revisions'))
      this.data.revisions.push(parameters);
    else if (sql.startsWith('insert into mammoth_audit_log')) {
      if (this.failAudit) throw new Error('injected audit failure');
      this.data.audits.push(parameters);
    } else if (sql.startsWith('insert into mammoth_outbox'))
      this.data.outbox.push(parameters);
    return {
      rows: [],
      rowCount: sql.startsWith('update mammoth_epistemic_ledger') ? 1 : 0,
    };
  }
  async transaction<T>(
    _options: TransactionOptions,
    operation: (transaction: PostgresConnection) => Promise<T>,
  ): Promise<T> {
    let release = (): void => undefined;
    const previous = this.#queue;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(this.data);
    try {
      return await operation(this);
    } catch (error) {
      this.data = snapshot;
      throw error;
    } finally {
      release();
    }
  }
}

const options = {
  transaction: { statementTimeoutMs: 1_000, transactionTimeoutMs: 2_000 },
  now: () => '2026-07-10T00:00:00.000Z',
  id: (() => {
    let id = 0;
    return () => `mutation-${String(++id)}`;
  })(),
};

describe('Postgres epistemic ledger', () => {
  it('serializes writers and deterministically rejects a stale revision', async () => {
    const database = new FakeDatabase();
    const first = new PostgresEpistemicLedger(database, options);
    const second = new PostgresEpistemicLedger(database, options);
    const results = await Promise.allSettled([
      first.transactAtRevision(0, (draft) => {
        draft.claims.push(claim('claim-a'));
      }),
      second.transactAtRevision(0, (draft) => {
        draft.claims.push(claim('claim-b'));
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'stale_revision', retryable: true },
    });
    expect((await first.read()).revision).toBe(1);
    expect(database.data.revisions).toHaveLength(1);
    expect(database.data.audits).toHaveLength(1);
    expect(database.data.outbox).toHaveLength(1);
  });

  it('rolls authoritative state, audit, and outbox back as one unit', async () => {
    const database = new FakeDatabase();
    database.failAudit = true;
    const ledger = new PostgresEpistemicLedger(database, options);
    await expect(
      ledger.transact((draft) => {
        draft.claims.push(claim('claim-a'));
      }),
    ).rejects.toThrow('injected audit failure');
    expect(database.data.state).toEqual(emptyState());
    expect(database.data.revisions).toEqual([]);
    expect(database.data.audits).toEqual([]);
    expect(database.data.outbox).toEqual([]);
  });

  it('validates claim, assessment, evidence, dependency, and lineage references', async () => {
    const database = new FakeDatabase();
    const ledger = new PostgresEpistemicLedger(database, options);
    await expect(
      ledger.transact((draft) => {
        draft.assessments.push({
          id: 'assessment-a',
          claimId: 'missing',
          evidenceIds: [],
        } as never);
      }),
    ).rejects.toMatchObject({
      code: 'referential_integrity',
      retryable: false,
    });
    await expect(
      ledger.transact((draft) => {
        draft.claims.push(claim('claim-a'));
        draft.evidence.push({
          id: 'evidence-a',
          sourceLineageId: 'missing',
        } as never);
      }),
    ).rejects.toMatchObject({ code: 'referential_integrity' });
    await expect(
      ledger.transact((draft) => {
        draft.claims.push(claim('claim-a'), claim('claim-b'));
        draft.claimDependencies.push(
          {
            id: 'dep-a',
            claimId: 'claim-a',
            dependsOnClaimId: 'claim-b',
            kind: 'requires',
          },
          {
            id: 'dep-b',
            claimId: 'claim-b',
            dependsOnClaimId: 'claim-a',
            kind: 'requires',
          },
        );
      }),
    ).rejects.toThrow(/cycle/);
    expect(database.data.state.revision).toBe(0);
    expect(database.data.outbox).toEqual([]);
  });

  it('emits no audit or outbox event when mutation code rejects', async () => {
    const database = new FakeDatabase();
    const ledger = new PostgresEpistemicLedger(database, options);
    await expect(
      ledger.transact(() => {
        throw new Error('policy rejected');
      }),
    ).rejects.toThrow('policy rejected');
    expect(database.data.revisions).toEqual([]);
    expect(database.data.audits).toEqual([]);
    expect(database.data.outbox).toEqual([]);
  });
});

function emptyState(): LedgerState {
  return {
    schemaVersion: 1,
    revision: 0,
    claims: [],
    assessments: [],
    evidence: [],
    claimEvidenceEdges: [],
    claimDependencies: [],
    sourceLineages: [],
  };
}
function claim(id: string): LedgerState['claims'][number] {
  return {
    id,
    programId: 'program',
    criterionId: 'criterion',
    version: 1,
    kind: 'external_fact',
    canonicalText: `${id} canonical text`,
    subject: id,
    predicate: 'is',
    object: 'fixture',
    status: 'candidate',
    observedAt: '2026-07-10T00:00:00.000Z',
    recordedAt: '2026-07-10T00:00:00.000Z',
    contradictedByClaimIds: [],
    canonicalDigest:
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  };
}
function result<Row extends Record<string, unknown>>(
  row: Record<string, unknown>,
): QueryResult<Row> {
  return { rows: [row as Row], rowCount: 1 };
}
