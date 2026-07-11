export interface GovernanceAuditEvent {
  sequence: number;
  occurredAt: string;
  kind: string;
  entityId: string;
  outcome: 'allowed' | 'denied';
  actorId: string;
  reason?: string;
  details: Readonly<Record<string, unknown>>;
}

export class GovernanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GovernanceError';
  }
}

export type Clock = () => string;
export const systemClock: Clock = () => new Date().toISOString();

export function copy<T>(value: T): T {
  return structuredClone(value);
}

export class AuditJournal {
  readonly #events: GovernanceAuditEvent[] = [];

  append(event: Omit<GovernanceAuditEvent, 'sequence'>): void {
    this.#events.push({ ...copy(event), sequence: this.#events.length });
  }

  list(): readonly GovernanceAuditEvent[] {
    return copy(this.#events);
  }

  snapshot(): readonly GovernanceAuditEvent[] {
    return this.list();
  }

  static restore(input: unknown): AuditJournal {
    const events = z
      .array(
        z
          .object({
            sequence: z.number().int().nonnegative(),
            occurredAt: z.string().datetime(),
            kind: z.string().min(1),
            entityId: z.string().min(1),
            outcome: z.enum(['allowed', 'denied']),
            actorId: z.string().min(1),
            reason: z.string().optional(),
            details: z.record(z.unknown()),
          })
          .strict(),
      )
      .parse(input);
    if (events.some((event, index) => event.sequence !== index))
      throw new GovernanceError(
        'invalid_audit_sequence',
        'audit sequence must be contiguous from zero',
      );
    const journal = new AuditJournal();
    for (const event of events)
      journal.#events.push(copy(event) as GovernanceAuditEvent);
    return journal;
  }
}
import { z } from 'zod';
