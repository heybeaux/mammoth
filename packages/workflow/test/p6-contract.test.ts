import { describe, expect, it, vi } from 'vitest';
import {
  P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
  P6_TOPOLOGY_PLANNER_POLICY_VERSION,
  createP6TopologyCarry,
  deriveP6ChildWorkflowId,
  deriveP6SynthesisInputId,
  deriveP6SynthesisOutputId,
  deriveP6TopologyWorkflowId,
  parseP6TopologyCarry,
  reconstructP6TopologyAfterContinueAsNew,
  type P6TopologyCellIdentity,
  type P6TopologyIdentity,
} from '../src/index.js';

const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const digestB =
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const identity: P6TopologyIdentity = {
  topologyId: 'topology-p6',
  topologyDigest: digest,
  dependencyDigest: digestB,
  programId: 'program-p6',
  workItemId: 'work-p6',
  criterion: {
    criterionId: 'criterion-p6',
    criterionVersion: 1,
    criterionDigest: digest,
    branchId: 'main',
  },
  topologyPlanVersion: P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
  plannerPolicyVersion: P6_TOPOLOGY_PLANNER_POLICY_VERSION,
  templateCatalogVersion: '1.0.0',
};

const cellIdentity: P6TopologyCellIdentity = {
  topology: identity,
  nodeId: 'landscape',
  cellId: 'cell-landscape',
  templateId: 'p6-landscape',
  templateVersion: 1,
  inputDigest: digest,
  dependencyDigest: digestB,
  attempt: 1,
};

describe('P6 topology workflow contracts', () => {
  it('derives stable parent, child, and synthesis identities', () => {
    expect(deriveP6TopologyWorkflowId(identity)).toContain('TopologyWorkflow');
    expect(deriveP6TopologyWorkflowId({ ...identity })).toBe(
      deriveP6TopologyWorkflowId(identity),
    );
    expect(deriveP6ChildWorkflowId(cellIdentity)).toContain(
      'TopologyCellWorkflow',
    );
    expect(deriveP6ChildWorkflowId({ ...cellIdentity, attempt: 2 })).not.toBe(
      deriveP6ChildWorkflowId(cellIdentity),
    );
    expect(deriveP6SynthesisInputId(identity)).toContain(
      'topology-synthesis-input',
    );
    expect(deriveP6SynthesisOutputId(identity)).toContain(
      'topology-synthesis-output',
    );
  });

  it('carries only stable topology identifiers across continueAsNew', async () => {
    const carry = createP6TopologyCarry({
      identity,
      schedulerState: 'blocked_dependencies',
      completedBoundaries: ['topology_planned', 'cell_dispatched'],
      receiptIds: ['receipt-plan', 'receipt-dispatch'],
    });
    expect(carry).toMatchObject({
      p6ContractMajor: 1,
      p6WorkflowVersion: 1,
      workflowId: deriveP6TopologyWorkflowId(identity),
      topologyId: identity.topologyId,
      schedulerState: 'blocked_dependencies',
    });
    expect(JSON.stringify(carry)).not.toContain('TemporalHistory');
    expect(JSON.stringify(carry)).not.toContain('productState');

    const loadTopologyState = vi.fn(() =>
      Promise.resolve({ authoritativeRevision: 12 }),
    );
    await expect(
      reconstructP6TopologyAfterContinueAsNew(carry, { loadTopologyState }),
    ).resolves.toEqual({ authoritativeRevision: 12 });
    expect(loadTopologyState).toHaveBeenCalledWith({
      identity,
      schedulerState: 'blocked_dependencies',
      completedBoundaries: ['topology_planned', 'cell_dispatched'],
      receiptIds: ['receipt-plan', 'receipt-dispatch'],
    });
  });

  it('fails closed on hidden state, identity drift, unsupported versions, and oversized receipts', () => {
    const carry = createP6TopologyCarry({
      identity,
      schedulerState: 'ready',
      completedBoundaries: ['topology_planned'],
      receiptIds: ['receipt-plan'],
    });
    expect(() =>
      parseP6TopologyCarry({ ...carry, productState: 'hidden' }),
    ).toThrow('P6 topology carry has invalid fields');
    expect(() =>
      parseP6TopologyCarry({ ...carry, p6WorkflowVersion: 2 }),
    ).toThrow('unsupported P6 topology workflow version');
    expect(() =>
      parseP6TopologyCarry({ ...carry, topologyDigest: digestB }),
    ).toThrow('P6 topology carry workflow identity mismatch');
    expect(() =>
      parseP6TopologyCarry({
        ...carry,
        receiptIds: Array.from(
          { length: 33 },
          (_, index) => `receipt-${index}`,
        ),
      }),
    ).toThrow('P6 continue-as-new carry has too many receipts');
  });
});
