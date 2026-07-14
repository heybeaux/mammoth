import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson } from '@mammoth/domain';
import {
  InMemoryP7ModelWorkRepository,
  type P7ArtifactReferenceRecord,
  type P7BudgetReleaseRecord,
  type P7CancellationFenceRecord,
  type P7CapabilityDecisionRecord,
  type P7ChargeSettlementInput,
  type P7EgressDecisionRecord,
  type P7ModelWorkRecord,
  type P7ModelWorkRepository,
  type P7ProviderAttemptRecord,
  type P7ReconstructedState,
  type P7ReconstructionLinkRecord,
  type P7ValidationResidueRecord,
} from './p7-model-work.js';

type JournalOp =
  | 'recordModelWork'
  | 'recordProviderAttempt'
  | 'recordCapabilityDecision'
  | 'recordEgressDecision'
  | 'recordArtifact'
  | 'recordValidationResidue'
  | 'recordChargeAndSettlement'
  | 'recordRelease'
  | 'recordCancellationFence'
  | 'recordReconstructionLink'
  | 'transitionModelWork'
  | 'transitionProviderAttempt';

interface JournalEntry {
  readonly op: JournalOp;
  readonly input: unknown;
}

/**
 * Durable local P7 authority: an append-only fsync'd JSONL journal replayed
 * through the validated in-memory repository on open. A torn final line
 * (crash mid-append) is discarded because its operation was never
 * acknowledged to the caller.
 */
export class JournaledP7ModelWorkRepository implements P7ModelWorkRepository {
  #queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly inner: InMemoryP7ModelWorkRepository,
    private readonly handle: FileHandle,
  ) {}

  static async open(path: string): Promise<JournaledP7ModelWorkRepository> {
    await mkdir(dirname(path), { recursive: true });
    const inner = new InMemoryP7ModelWorkRepository();
    let text = '';
    try {
      text = await readFile(path, 'utf8');
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }
    const lines = text.split('\n').filter((line) => line.length > 0);
    for (const [index, line] of lines.entries()) {
      let entry: JournalEntry;
      try {
        entry = JSON.parse(line) as JournalEntry;
      } catch (error: unknown) {
        if (index === lines.length - 1) break;
        throw error;
      }
      await replay(inner, entry);
    }
    const handle = await open(path, 'a', 0o600);
    return new JournaledP7ModelWorkRepository(inner, handle);
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  recordModelWork(input: P7ModelWorkRecord): Promise<P7ModelWorkRecord> {
    return this.#apply('recordModelWork', input, (repo) =>
      repo.recordModelWork(input),
    );
  }

  recordProviderAttempt(
    input: P7ProviderAttemptRecord,
  ): Promise<P7ProviderAttemptRecord> {
    return this.#apply('recordProviderAttempt', input, (repo) =>
      repo.recordProviderAttempt(input),
    );
  }

  recordCapabilityDecision(
    input: P7CapabilityDecisionRecord,
  ): Promise<P7CapabilityDecisionRecord> {
    return this.#apply('recordCapabilityDecision', input, (repo) =>
      repo.recordCapabilityDecision(input),
    );
  }

  recordEgressDecision(
    input: P7EgressDecisionRecord,
  ): Promise<P7EgressDecisionRecord> {
    return this.#apply('recordEgressDecision', input, (repo) =>
      repo.recordEgressDecision(input),
    );
  }

  recordArtifact(
    input: P7ArtifactReferenceRecord,
  ): Promise<P7ArtifactReferenceRecord> {
    return this.#apply('recordArtifact', input, (repo) =>
      repo.recordArtifact(input),
    );
  }

  recordValidationResidue(
    input: P7ValidationResidueRecord,
  ): Promise<P7ValidationResidueRecord> {
    return this.#apply('recordValidationResidue', input, (repo) =>
      repo.recordValidationResidue(input),
    );
  }

  recordChargeAndSettlement(
    input: P7ChargeSettlementInput,
  ): Promise<P7ChargeSettlementInput> {
    return this.#apply('recordChargeAndSettlement', input, (repo) =>
      repo.recordChargeAndSettlement(input),
    );
  }

  recordRelease(input: P7BudgetReleaseRecord): Promise<P7BudgetReleaseRecord> {
    return this.#apply('recordRelease', input, (repo) =>
      repo.recordRelease(input),
    );
  }

  recordCancellationFence(
    input: P7CancellationFenceRecord,
  ): Promise<P7CancellationFenceRecord> {
    return this.#apply('recordCancellationFence', input, (repo) =>
      repo.recordCancellationFence(input),
    );
  }

  recordReconstructionLink(
    input: P7ReconstructionLinkRecord,
  ): Promise<P7ReconstructionLinkRecord> {
    return this.#apply('recordReconstructionLink', input, (repo) =>
      repo.recordReconstructionLink(input),
    );
  }

  transitionModelWork(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ModelWorkRecord['state'];
    readonly updatedAt: string;
  }): Promise<P7ModelWorkRecord> {
    return this.#apply('transitionModelWork', input, (repo) =>
      repo.transitionModelWork(input),
    );
  }

  transitionProviderAttempt(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly state: P7ProviderAttemptRecord['state'];
    readonly updatedAt: string;
  }): Promise<P7ProviderAttemptRecord> {
    return this.#apply('transitionProviderAttempt', input, (repo) =>
      repo.transitionProviderAttempt(input),
    );
  }

  reconstructProgram(programId: string): Promise<P7ReconstructedState> {
    return this.inner.reconstructProgram(programId);
  }

  async #apply<T>(
    op: JournalOp,
    input: unknown,
    operation: (repo: InMemoryP7ModelWorkRepository) => Promise<T>,
  ): Promise<T> {
    let result: T | undefined;
    const pending = this.#queue.then(async () => {
      result = await operation(this.inner);
      await this.handle.writeFile(
        `${canonicalJson({ op, input } satisfies JournalEntry)}\n`,
        'utf8',
      );
      await this.handle.sync();
    });
    this.#queue = pending.catch(() => undefined);
    await pending;
    return result as T;
  }
}

async function replay(
  repo: InMemoryP7ModelWorkRepository,
  entry: JournalEntry,
): Promise<void> {
  switch (entry.op) {
    case 'recordModelWork':
      await repo.recordModelWork(entry.input as P7ModelWorkRecord);
      return;
    case 'recordProviderAttempt':
      await repo.recordProviderAttempt(entry.input as P7ProviderAttemptRecord);
      return;
    case 'recordCapabilityDecision':
      await repo.recordCapabilityDecision(
        entry.input as P7CapabilityDecisionRecord,
      );
      return;
    case 'recordEgressDecision':
      await repo.recordEgressDecision(entry.input as P7EgressDecisionRecord);
      return;
    case 'recordArtifact':
      await repo.recordArtifact(entry.input as P7ArtifactReferenceRecord);
      return;
    case 'recordValidationResidue':
      await repo.recordValidationResidue(
        entry.input as P7ValidationResidueRecord,
      );
      return;
    case 'recordChargeAndSettlement':
      await repo.recordChargeAndSettlement(
        entry.input as P7ChargeSettlementInput,
      );
      return;
    case 'recordRelease':
      await repo.recordRelease(entry.input as P7BudgetReleaseRecord);
      return;
    case 'recordCancellationFence':
      await repo.recordCancellationFence(
        entry.input as P7CancellationFenceRecord,
      );
      return;
    case 'recordReconstructionLink':
      await repo.recordReconstructionLink(
        entry.input as P7ReconstructionLinkRecord,
      );
      return;
    case 'transitionModelWork':
      await repo.transitionModelWork(
        entry.input as Parameters<
          InMemoryP7ModelWorkRepository['transitionModelWork']
        >[0],
      );
      return;
    case 'transitionProviderAttempt':
      await repo.transitionProviderAttempt(
        entry.input as Parameters<
          InMemoryP7ModelWorkRepository['transitionProviderAttempt']
        >[0],
      );
      return;
    default:
      throw new Error(
        `P7 journal contains unknown operation ${String(entry.op)}`,
      );
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
