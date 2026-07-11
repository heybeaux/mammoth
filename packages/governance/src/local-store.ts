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
      throw error;
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
      throw error;
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
      BudgetLedger.restore(envelope.budgets, clock),
      HumanGateRegistry.restore(envelope.humanGates, clock),
      RevalidationScheduler.restore(envelope.revalidation, clock),
    );
  }
}

export class GovernanceCoordinator {
  constructor(
    readonly store: LocalGovernanceStore,
    private readonly clock: Clock = systemClock,
    readonly budgets = new BudgetLedger(clock),
    readonly humanGates = new HumanGateRegistry(clock),
    readonly revalidation = new RevalidationScheduler(clock),
  ) {}

  snapshot(): GovernanceSnapshot {
    return {
      version: 1,
      savedAt: this.clock(),
      budgets: this.budgets.snapshot(),
      humanGates: this.humanGates.snapshot(),
      revalidation: this.revalidation.snapshot(),
    };
  }

  async checkpoint(): Promise<void> {
    await this.store.save(this.snapshot());
  }
}
