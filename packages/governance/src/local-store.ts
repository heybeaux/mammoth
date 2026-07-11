import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { BudgetLedger, type BudgetLedgerSnapshot } from './budgets.js';
import { type Clock, GovernanceError, systemClock } from './common.js';
import { HumanGateRegistry, type HumanGateSnapshot } from './human-gates.js';
import {
  RevalidationScheduler,
  type RevalidationSnapshot,
} from './revalidation.js';

export interface GovernanceSnapshot {
  version: 1;
  savedAt: string;
  budgets: BudgetLedgerSnapshot;
  humanGates: HumanGateSnapshot;
  revalidation: RevalidationSnapshot;
}

export class LocalGovernanceStore {
  constructor(readonly path: string) {}

  async save(snapshot: GovernanceSnapshot): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.path}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
      const directoryHandle = await open(directory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async load(
    clock: Clock = systemClock,
  ): Promise<GovernanceCoordinator | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error instanceof Error ? error : new Error(String(error));
    }
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new GovernanceError(
        'invalid_governance_snapshot',
        'governance snapshot is not valid JSON',
      );
    }
    const envelope = z
      .object({
        version: z.literal(1),
        savedAt: z.string().datetime(),
        budgets: z.unknown(),
        humanGates: z.unknown(),
        revalidation: z.unknown(),
      })
      .strict()
      .parse(input);
    return new GovernanceCoordinator(
      this,
      clock,
      envelope as GovernanceSnapshot,
    );
  }
}

export class GovernanceCoordinator {
  #budgets: BudgetLedger;
  #humanGates: HumanGateRegistry;
  #revalidation: RevalidationScheduler;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly store: LocalGovernanceStore,
    private readonly clock: Clock = systemClock,
    restored?: GovernanceSnapshot,
  ) {
    this.#budgets = restored
      ? BudgetLedger.restore(restored.budgets, clock)
      : new BudgetLedger(clock);
    this.#humanGates = restored
      ? HumanGateRegistry.restore(restored.humanGates, clock)
      : new HumanGateRegistry(clock);
    this.#revalidation = restored
      ? RevalidationScheduler.restore(restored.revalidation, clock)
      : new RevalidationScheduler(clock);
  }

  snapshot(): GovernanceSnapshot {
    return {
      version: 1,
      savedAt: this.clock(),
      budgets: this.#budgets.snapshot(),
      humanGates: this.#humanGates.snapshot(),
      revalidation: this.#revalidation.snapshot(),
    };
  }

  async checkpoint(): Promise<void> {
    await this.store.save(this.snapshot());
  }

  getBudgetAccount(id: string) {
    return this.#budgets.getAccount(id);
  }

  getBudgetReservation(id: string) {
    return this.#budgets.getReservation(id);
  }

  async createBudgetAccount(
    input: Parameters<BudgetLedger['createAccount']>[0],
    actorId: string,
  ) {
    return this.#mutate(() => this.#budgets.createAccount(input, actorId));
  }

  async reserveBudget(
    input: Parameters<BudgetLedger['reserve']>[0],
    actorId: string,
  ) {
    return this.#mutate(() => this.#budgets.reserve(input, actorId));
  }

  async commitBudget(
    id: string,
    actual: Parameters<BudgetLedger['commit']>[1],
    actorId: string,
  ) {
    return this.#mutate(() => this.#budgets.commit(id, actual, actorId));
  }

  async releaseBudget(id: string, actorId: string, reason: string) {
    return this.#mutate(() => this.#budgets.release(id, actorId, reason));
  }

  async getHumanGate(id: string) {
    // Reading a gate may expire it, which is an authoritative transition.
    return this.#mutate(() => this.#humanGates.get(id));
  }

  async openHumanGate(
    input: Parameters<HumanGateRegistry['open']>[0],
    actorId: string,
  ) {
    return this.#mutate(() => this.#humanGates.open(input, actorId));
  }

  async decideHumanGate(
    id: string,
    decision: Parameters<HumanGateRegistry['decide']>[1],
    input: Parameters<HumanGateRegistry['decide']>[2],
  ) {
    return this.#mutate(() => this.#humanGates.decide(id, decision, input));
  }

  async cancelHumanGate(id: string, actorId: string, reason: string) {
    return this.#mutate(() => this.#humanGates.cancel(id, actorId, reason));
  }

  getRevalidation(id: string) {
    return this.#revalidation.get(id);
  }

  async scheduleRevalidation(
    input: Parameters<RevalidationScheduler['schedule']>[0],
    actorId: string,
  ) {
    return this.#mutate(() => this.#revalidation.schedule(input, actorId));
  }

  async claimDueRevalidations(
    workerId: string,
    leaseMs: number,
    limit?: number,
  ) {
    return this.#mutate(() =>
      this.#revalidation.claimDue(workerId, leaseMs, limit),
    );
  }

  async completeRevalidation(
    id: string,
    input: Parameters<RevalidationScheduler['complete']>[1],
  ) {
    return this.#mutate(() => this.#revalidation.complete(id, input));
  }

  budgetAudit() {
    return this.#budgets.audit.list();
  }

  humanGateAudit() {
    return this.#humanGates.audit.list();
  }

  revalidationAudit() {
    return this.#revalidation.audit.list();
  }

  async #mutate<T>(mutation: () => T): Promise<T> {
    const operation = this.#queue.then(() => this.#performMutation(mutation));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async #performMutation<T>(mutation: () => T): Promise<T> {
    const before = this.snapshot();
    let result: T | undefined;
    let mutationError: unknown;
    try {
      result = mutation();
    } catch (error: unknown) {
      // Denials and expirations append authoritative audit events before
      // throwing. Persist that state before surfacing the domain error.
      mutationError = error;
    }
    try {
      await this.store.save(this.snapshot());
    } catch (error: unknown) {
      this.#budgets = BudgetLedger.restore(before.budgets, this.clock);
      this.#humanGates = HumanGateRegistry.restore(
        before.humanGates,
        this.clock,
      );
      this.#revalidation = RevalidationScheduler.restore(
        before.revalidation,
        this.clock,
      );
      throw error instanceof Error
        ? error
        : new Error('governance snapshot save failed');
    }
    if (mutationError !== undefined) {
      throw mutationError instanceof Error
        ? mutationError
        : new Error('governance mutation failed with a non-Error value');
    }
    return result as T;
  }
}
