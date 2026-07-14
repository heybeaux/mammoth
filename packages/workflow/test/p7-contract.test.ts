import { describe, expect, it } from 'vitest';
import {
  P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
  P6_TOPOLOGY_PLANNER_POLICY_VERSION,
  P7_APPLICATION_CONTRACT_MAJOR,
  P7_WORKFLOW_VERSION,
  deriveP7ResearchRunId,
  parseP7ResearchRunRequest,
  type P7ResearchApplicationPort,
  type P7ResearchRunRequest,
} from '../src/index.js';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;

const request: P7ResearchRunRequest = {
  applicationContractMajor: P7_APPLICATION_CONTRACT_MAJOR,
  workflowVersion: P7_WORKFLOW_VERSION,
  charterDigest: digestA,
  topology: {
    topologyId: 'topology-1',
    topologyDigest: digestA,
    dependencyDigest: digestB,
    programId: 'program-1',
    workItemId: 'work-1',
    criterion: {
      criterionId: 'criterion-1',
      criterionVersion: 1,
      criterionDigest: digestA,
      branchId: 'main',
    },
    topologyPlanVersion: P6_TOPOLOGY_PLAN_SCHEMA_VERSION,
    plannerPolicyVersion: P6_TOPOLOGY_PLANNER_POLICY_VERSION,
    templateCatalogVersion: '1.0.0',
  },
  modelWorkPolicyDigest: digestA,
  modelProfileVersionId: 'profile-version-1',
  modelProfileVersionDigest: digestB,
  promptTemplateDigest: digestA,
  toolContractDigest: digestB,
  outputSchemaDigest: digestA,
  budget: {
    inputTokens: 10_000,
    outputTokens: 2_000,
    currencyMicros: 0,
    wallClockMs: 60_000,
    toolCalls: 0,
  },
};

describe('P7 application and workflow entry contract', () => {
  it('derives a stable run identity from every frozen input', () => {
    expect(deriveP7ResearchRunId({ ...request })).toBe(
      deriveP7ResearchRunId(request),
    );
    expect(
      deriveP7ResearchRunId({
        ...request,
        promptTemplateDigest: digestB,
      }),
    ).not.toBe(deriveP7ResearchRunId(request));
  });

  it('rejects hidden authority, unsupported versions, and tool escalation', () => {
    expect(parseP7ResearchRunRequest(request)).toEqual(request);
    expect(() =>
      parseP7ResearchRunRequest({ ...request, productState: {} }),
    ).toThrow('P7 research run request has invalid fields');
    expect(() =>
      parseP7ResearchRunRequest({ ...request, workflowVersion: 2 }),
    ).toThrow('unsupported P7 workflow version');
    expect(() =>
      parseP7ResearchRunRequest({
        ...request,
        budget: { ...request.budget, toolCalls: 1 },
      }),
    ).toThrow('P7 tools are disabled');
  });

  it('keeps the operator API behind one application port', () => {
    const methods: Record<keyof P7ResearchApplicationPort, true> = {
      run: true,
      resume: true,
      cancel: true,
      status: true,
      inspect: true,
    };
    expect(Object.keys(methods).sort()).toEqual([
      'cancel',
      'inspect',
      'resume',
      'run',
      'status',
    ]);
  });
});
