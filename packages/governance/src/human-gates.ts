import { z } from 'zod';
import {
  AuditJournal,
  copy,
  type Clock,
  type GovernanceAuditEvent,
  GovernanceError,
  systemClock,
} from './common.js';

export interface HumanGate {
  id: string;
  programId: string;
  workItemId: string;
  kind: string;
  summary: string;
  requestedDecision: string;
  evidenceIds: string[];
  claimIds: string[];
  riskCodes: string[];
  state:
    | 'open'
    | 'approved'
    | 'rejected'
    | 'work_requested'
    | 'expired'
    | 'cancelled';
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  receiptId?: string;
}

export type GateDecision = 'approve' | 'reject' | 'request_work';
export interface HumanGateSnapshot {
  version: 1;
  gates: HumanGate[];
  audit: readonly GovernanceAuditEvent[];
}

export class HumanGateRegistry {
  readonly #gates = new Map<string, HumanGate>();
  audit = new AuditJournal();
  constructor(private readonly clock: Clock = systemClock) {}

  open(
    input: Omit<
      HumanGate,
      | 'state'
      | 'createdAt'
      | 'decidedAt'
      | 'decidedBy'
      | 'decisionReason'
      | 'receiptId'
    >,
    actorId: string,
  ): HumanGate {
    if (this.#gates.has(input.id))
      throw new GovernanceError('gate_exists', 'human gate already exists');
    const createdAt = this.clock();
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.parse(createdAt))
      throw new GovernanceError(
        'invalid_expiry',
        'gate expiry must be in the future',
      );
    const gate: HumanGate = { ...copy(input), state: 'open', createdAt };
    this.#gates.set(gate.id, gate);
    this.audit.append({
      occurredAt: createdAt,
      kind: 'human_gate.opened',
      entityId: gate.id,
      outcome: 'allowed',
      actorId,
      details: {
        programId: gate.programId,
        workItemId: gate.workItemId,
        riskCodes: gate.riskCodes,
      },
    });
    return copy(gate);
  }

  get(id: string): HumanGate | undefined {
    const gate = this.#gates.get(id);
    if (!gate) return undefined;
    this.#expireIfNeeded(gate);
    return copy(gate);
  }

  snapshot(): HumanGateSnapshot {
    return {
      version: 1,
      gates: copy([...this.#gates.values()]),
      audit: this.audit.snapshot(),
    };
  }

  static restore(
    input: unknown,
    clock: Clock = systemClock,
  ): HumanGateRegistry {
    const gate = z
      .object({
        id: z.string().min(1),
        programId: z.string().min(1),
        workItemId: z.string().min(1),
        kind: z.string().min(1),
        summary: z.string().min(1),
        requestedDecision: z.string().min(1),
        evidenceIds: z.array(z.string().min(1)),
        claimIds: z.array(z.string().min(1)),
        riskCodes: z.array(z.string().min(1)),
        state: z.enum([
          'open',
          'approved',
          'rejected',
          'work_requested',
          'expired',
          'cancelled',
        ]),
        createdAt: z.string().datetime(),
        expiresAt: z.string().datetime().optional(),
        decidedAt: z.string().datetime().optional(),
        decidedBy: z.string().min(1).optional(),
        decisionReason: z.string().min(1).optional(),
        receiptId: z.string().min(1).optional(),
      })
      .strict();
    const snapshot = z
      .object({
        version: z.literal(1),
        gates: z.array(gate),
        audit: z.array(z.unknown()),
      })
      .strict()
      .parse(input);
    const registry = new HumanGateRegistry(clock);
    for (const value of snapshot.gates) {
      if (registry.#gates.has(value.id))
        throw new GovernanceError('invalid_gate_snapshot', 'duplicate gate id');
      if (
        ['approved', 'rejected', 'work_requested'].includes(value.state) &&
        (!value.decidedAt ||
          !value.decidedBy ||
          !value.decisionReason ||
          !value.receiptId)
      )
        throw new GovernanceError(
          'invalid_gate_snapshot',
          'human decision is missing attribution or receipt',
        );
      registry.#gates.set(value.id, copy(value) as HumanGate);
    }
    registry.audit = AuditJournal.restore(snapshot.audit);
    return registry;
  }

  decide(
    id: string,
    decision: GateDecision,
    input: { actorId: string; reason: string; receiptId: string },
  ): HumanGate {
    const gate = this.#gates.get(id);
    if (!gate) return this.#denied(id, input.actorId, 'gate_not_found');
    this.#expireIfNeeded(gate);
    if (gate.state !== 'open')
      return this.#denied(id, input.actorId, `gate_${gate.state}`);
    if (!input.reason.trim())
      return this.#denied(id, input.actorId, 'reason_required');
    if (!input.receiptId.trim())
      return this.#denied(id, input.actorId, 'receipt_required');
    gate.state =
      decision === 'approve'
        ? 'approved'
        : decision === 'reject'
          ? 'rejected'
          : 'work_requested';
    gate.decidedAt = this.clock();
    gate.decidedBy = input.actorId;
    gate.decisionReason = input.reason;
    gate.receiptId = input.receiptId;
    this.audit.append({
      occurredAt: gate.decidedAt,
      kind: 'human_gate.decided',
      entityId: id,
      outcome: 'allowed',
      actorId: input.actorId,
      reason: input.reason,
      details: { decision, receiptId: input.receiptId },
    });
    return copy(gate);
  }

  cancel(id: string, actorId: string, reason: string): HumanGate {
    const gate = this.#gates.get(id);
    if (!gate) return this.#denied(id, actorId, 'gate_not_found');
    this.#expireIfNeeded(gate);
    if (gate.state !== 'open')
      return this.#denied(id, actorId, `gate_${gate.state}`);
    if (!reason.trim()) return this.#denied(id, actorId, 'reason_required');
    gate.state = 'cancelled';
    gate.decidedAt = this.clock();
    gate.decidedBy = actorId;
    gate.decisionReason = reason;
    this.audit.append({
      occurredAt: gate.decidedAt,
      kind: 'human_gate.cancelled',
      entityId: id,
      outcome: 'allowed',
      actorId,
      reason,
      details: {},
    });
    return copy(gate);
  }

  #expireIfNeeded(gate: HumanGate): void {
    const now = this.clock();
    if (
      gate.state === 'open' &&
      gate.expiresAt &&
      Date.parse(gate.expiresAt) <= Date.parse(now)
    ) {
      gate.state = 'expired';
      gate.decidedAt = now;
      this.audit.append({
        occurredAt: now,
        kind: 'human_gate.expired',
        entityId: gate.id,
        outcome: 'denied',
        actorId: 'system',
        reason: 'approval_window_expired',
        details: {},
      });
    }
  }

  #denied(id: string, actorId: string, code: string): never {
    this.audit.append({
      occurredAt: this.clock(),
      kind: 'human_gate.decision_denied',
      entityId: id,
      outcome: 'denied',
      actorId,
      reason: code,
      details: {},
    });
    throw new GovernanceError(code, `human gate decision denied: ${code}`);
  }
}
