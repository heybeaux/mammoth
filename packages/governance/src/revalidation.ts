import { z } from 'zod';
import {
  AuditJournal,
  copy,
  type Clock,
  type GovernanceAuditEvent,
  GovernanceError,
  systemClock,
} from './common.js';

export interface RevalidationSchedule {
  id: string;
  programId: string;
  subjectType: 'claim' | 'evidence';
  subjectId: string;
  dueAt: string;
  state: 'scheduled' | 'leased' | 'completed' | 'cancelled';
  attempt: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  outcome?: 'fresh' | 'changed' | 'failed';
  receiptId?: string;
}
export interface RevalidationSnapshot {
  version: 1;
  schedules: RevalidationSchedule[];
  audit: readonly GovernanceAuditEvent[];
}

export class RevalidationScheduler {
  readonly #schedules = new Map<string, RevalidationSchedule>();
  audit = new AuditJournal();
  constructor(private readonly clock: Clock = systemClock) {}

  schedule(
    input: Omit<
      RevalidationSchedule,
      | 'state'
      | 'attempt'
      | 'leaseOwner'
      | 'leaseExpiresAt'
      | 'completedAt'
      | 'outcome'
      | 'receiptId'
    >,
    actorId: string,
  ): RevalidationSchedule {
    if (this.#schedules.has(input.id))
      throw new GovernanceError(
        'schedule_exists',
        'revalidation schedule already exists',
      );
    if (!Number.isFinite(Date.parse(input.dueAt)))
      throw new GovernanceError(
        'invalid_due_at',
        'dueAt must be a valid timestamp',
      );
    const schedule: RevalidationSchedule = {
      ...input,
      state: 'scheduled',
      attempt: 0,
    };
    this.#schedules.set(input.id, schedule);
    this.audit.append({
      occurredAt: this.clock(),
      kind: 'revalidation.scheduled',
      entityId: input.id,
      outcome: 'allowed',
      actorId,
      details: {
        dueAt: input.dueAt,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    });
    return copy(schedule);
  }

  claimDue(
    workerId: string,
    leaseMs: number,
    limit = 100,
  ): RevalidationSchedule[] {
    if (
      !workerId.trim() ||
      !Number.isInteger(leaseMs) ||
      leaseMs <= 0 ||
      !Number.isInteger(limit) ||
      limit <= 0
    )
      throw new GovernanceError(
        'invalid_lease',
        'valid worker, lease duration, and limit are required',
      );
    const now = this.clock();
    const nowMs = Date.parse(now);
    const due = [...this.#schedules.values()]
      .filter(
        (item) =>
          item.state === 'scheduled' ||
          (item.state === 'leased' &&
            Date.parse(item.leaseExpiresAt ?? '') <= nowMs),
      )
      .filter((item) => Date.parse(item.dueAt) <= nowMs)
      .sort(
        (a, b) =>
          Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id),
      )
      .slice(0, limit);
    for (const item of due) {
      item.state = 'leased';
      item.leaseOwner = workerId;
      item.leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      item.attempt++;
      this.audit.append({
        occurredAt: now,
        kind: 'revalidation.leased',
        entityId: item.id,
        outcome: 'allowed',
        actorId: workerId,
        details: { attempt: item.attempt, leaseExpiresAt: item.leaseExpiresAt },
      });
    }
    return copy(due);
  }

  complete(
    id: string,
    input: {
      workerId: string;
      outcome: 'fresh' | 'changed' | 'failed';
      receiptId: string;
      next?: { id: string; dueAt: string };
    },
  ): RevalidationSchedule {
    const schedule = this.#schedules.get(id);
    const completedAt = this.clock();
    if (
      !schedule ||
      schedule.state !== 'leased' ||
      schedule.leaseOwner !== input.workerId ||
      Date.parse(schedule.leaseExpiresAt ?? '') <= Date.parse(completedAt)
    )
      return this.#completionDenied(
        id,
        input.workerId,
        'invalid_or_expired_lease',
        'only the current lease owner may complete revalidation',
      );
    if (!input.receiptId.trim())
      return this.#completionDenied(
        id,
        input.workerId,
        'receipt_required',
        'revalidation completion requires a receipt',
      );
    if (input.outcome === 'failed' && !input.next)
      return this.#completionDenied(
        id,
        input.workerId,
        'retry_required',
        'failed revalidation must schedule a retry',
      );
    if (
      input.next &&
      (!Number.isFinite(Date.parse(input.next.dueAt)) ||
        Date.parse(input.next.dueAt) <= Date.parse(completedAt))
    )
      return this.#completionDenied(
        id,
        input.workerId,
        'invalid_next_due_at',
        'next revalidation must be scheduled in the future',
      );
    if (input.next && this.#schedules.has(input.next.id))
      return this.#completionDenied(
        id,
        input.workerId,
        'schedule_exists',
        'next schedule id already exists',
      );
    schedule.state = 'completed';
    schedule.completedAt = completedAt;
    schedule.outcome = input.outcome;
    schedule.receiptId = input.receiptId;
    this.audit.append({
      occurredAt: completedAt,
      kind: 'revalidation.completed',
      entityId: id,
      outcome: 'allowed',
      actorId: input.workerId,
      details: { outcome: input.outcome, receiptId: input.receiptId },
    });
    if (input.next)
      this.schedule(
        {
          id: input.next.id,
          programId: schedule.programId,
          subjectType: schedule.subjectType,
          subjectId: schedule.subjectId,
          dueAt: input.next.dueAt,
        },
        input.workerId,
      );
    return copy(schedule);
  }

  get(id: string): RevalidationSchedule | undefined {
    const schedule = this.#schedules.get(id);
    return schedule ? copy(schedule) : undefined;
  }

  snapshot(): RevalidationSnapshot {
    return {
      version: 1,
      schedules: copy([...this.#schedules.values()]),
      audit: this.audit.snapshot(),
    };
  }

  static restore(
    input: unknown,
    clock: Clock = systemClock,
  ): RevalidationScheduler {
    const schedule = z
      .object({
        id: z.string().min(1),
        programId: z.string().min(1),
        subjectType: z.enum(['claim', 'evidence']),
        subjectId: z.string().min(1),
        dueAt: z.string().datetime(),
        state: z.enum(['scheduled', 'leased', 'completed', 'cancelled']),
        attempt: z.number().int().nonnegative(),
        leaseOwner: z.string().min(1).optional(),
        leaseExpiresAt: z.string().datetime().optional(),
        completedAt: z.string().datetime().optional(),
        outcome: z.enum(['fresh', 'changed', 'failed']).optional(),
        receiptId: z.string().min(1).optional(),
      })
      .strict();
    const snapshot = z
      .object({
        version: z.literal(1),
        schedules: z.array(schedule),
        audit: z.array(z.unknown()),
      })
      .strict()
      .parse(input);
    const scheduler = new RevalidationScheduler(clock);
    for (const value of snapshot.schedules) {
      if (scheduler.#schedules.has(value.id))
        throw new GovernanceError(
          'invalid_revalidation_snapshot',
          'duplicate schedule id',
        );
      if (
        value.state === 'leased' &&
        (!value.leaseOwner || !value.leaseExpiresAt)
      )
        throw new GovernanceError(
          'invalid_revalidation_snapshot',
          'leased schedule is missing its lease',
        );
      if (
        value.state === 'completed' &&
        (!value.completedAt || !value.outcome || !value.receiptId)
      )
        throw new GovernanceError(
          'invalid_revalidation_snapshot',
          'completed schedule is missing outcome or receipt',
        );
      scheduler.#schedules.set(value.id, copy(value) as RevalidationSchedule);
    }
    scheduler.audit = AuditJournal.restore(snapshot.audit);
    return scheduler;
  }

  #completionDenied(
    id: string,
    actorId: string,
    code: string,
    message: string,
  ): never {
    this.audit.append({
      occurredAt: this.clock(),
      kind: 'revalidation.completion_denied',
      entityId: id,
      outcome: 'denied',
      actorId,
      reason: code,
      details: {},
    });
    throw new GovernanceError(code, message);
  }
}
