import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterKind,
  AdapterRequirement,
} from './capabilities.js';

export const ADAPTER_CONTRACT_MAJOR = 1 as const;
export const ADAPTER_CONTRACT_VERSION = '1.1.0' as const;

export const LOCAL_ADAPTER_ROLES = [
  'workflow-state',
  'epistemic-ledger',
  'work-state',
  'effect-receipt',
  'side-effect-execution',
  'artifact-bytes',
] as const;

export type LocalAdapterRole = (typeof LOCAL_ADAPTER_ROLES)[number];

export const TEMPORAL_WORKFLOW_CAPABILITIES = [
  'deterministic-replay',
  'durable-timers',
  'signals',
  'queries',
  'retry-scheduling',
  'continue-as-new',
  'task-queue-polling',
  'clean-shutdown',
  'durable-restart',
  'cooperative-cancellation',
  'health-reporting',
] as const satisfies readonly AdapterCapability[];

export const ACTIVITY_EFFECT_CONTRACT_MAJOR = 2 as const;
export const ACTIVITY_EFFECT_CONTRACT_VERSION = '2.0.0' as const;
export const ACTIVITY_EFFECT_CAPABILITIES = [
  'stable-effect-identity',
  'attributable-attempts',
  'effect-lifecycle',
  'completed-effect-lookup',
  'strict-result-mapping',
  'provider-idempotency',
  'delivery-independent-replay',
  'fenced-work-completion',
  'cooperative-cancellation',
  'durable-restart',
  'health-reporting',
] as const satisfies readonly AdapterCapability[];

export interface LocalAdapterDescriptor extends AdapterDescriptor {
  readonly role: LocalAdapterRole;
}

const LOCAL_CHECKED_AT = '2026-07-10T00:00:00.000Z';

function localDescriptor(
  role: LocalAdapterRole,
  kind: AdapterKind,
  id: string,
  capabilities: readonly AdapterCapability[],
): LocalAdapterDescriptor {
  return {
    role,
    id,
    kind,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    implementationVersion: '0.1.0',
    profile: 'local',
    capabilities,
    health: 'healthy',
    checkedAt: LOCAL_CHECKED_AT,
  };
}

/** Describes the concrete adapters exercised by the local conformance suite. */
export const LOCAL_ADAPTER_DESCRIPTORS = [
  localDescriptor('workflow-state', 'workflow-store', 'local-workflow-store', [
    'atomic-transactions',
    'durable-restart',
    'health-reporting',
  ]),
  localDescriptor('epistemic-ledger', 'epistemic-ledger', 'local-json-ledger', [
    'atomic-transactions',
    'durable-restart',
    'health-reporting',
  ]),
  localDescriptor('work-state', 'work-state-store', 'local-work-state-store', [
    'atomic-transactions',
    'cross-process-fencing',
    'durable-restart',
    'cooperative-cancellation',
    'health-reporting',
  ]),
  localDescriptor('effect-receipt', 'receipt-writer', 'local-receipt-writer', [
    'atomic-transactions',
    'durable-restart',
    'cooperative-cancellation',
    'health-reporting',
  ]),
  localDescriptor(
    'side-effect-execution',
    'side-effect-executor',
    'durable-side-effect-executor',
    [
      'atomic-transactions',
      'durable-restart',
      'provider-idempotency',
      'cooperative-cancellation',
      'health-reporting',
    ],
  ),
  localDescriptor('artifact-bytes', 'artifact-store', 'file-content-store', [
    'durable-restart',
    'content-verification',
    'health-reporting',
  ]),
] as const satisfies readonly LocalAdapterDescriptor[];

export const PRODUCTION_LIKE_LOCAL_REQUIREMENTS = [
  requirement('workflow-store', [
    'atomic-transactions',
    'cross-process-fencing',
    'durable-restart',
    'health-reporting',
  ]),
  requirement('epistemic-ledger', [
    'atomic-transactions',
    'cross-process-fencing',
    'durable-restart',
    'health-reporting',
  ]),
  requirement('work-state-store', [
    'atomic-transactions',
    'cross-process-fencing',
    'durable-restart',
    'cooperative-cancellation',
    'health-reporting',
  ]),
  requirement('receipt-writer', [
    'atomic-transactions',
    'durable-restart',
    'cooperative-cancellation',
    'health-reporting',
  ]),
  requirement('side-effect-executor', [
    'atomic-transactions',
    'durable-restart',
    'provider-idempotency',
    'cooperative-cancellation',
    'health-reporting',
  ]),
  requirement('artifact-store', [
    'durable-restart',
    'content-verification',
    'health-reporting',
  ]),
] as const satisfies readonly AdapterRequirement[];

export const TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT = requirement(
  'workflow-runtime',
  TEMPORAL_WORKFLOW_CAPABILITIES,
);

export const ACTIVITY_EFFECT_REQUIREMENT = {
  kind: 'activity-effect',
  contractMajor: ACTIVITY_EFFECT_CONTRACT_MAJOR,
  capabilities: ACTIVITY_EFFECT_CAPABILITIES,
  requireProductionProfile: true,
} as const satisfies AdapterRequirement;

export const P3_TEMPORAL_PRODUCTION_LIKE_REQUIREMENTS = [
  ...PRODUCTION_LIKE_LOCAL_REQUIREMENTS,
  TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT,
  ACTIVITY_EFFECT_REQUIREMENT,
] as const satisfies readonly AdapterRequirement[];

function requirement(
  kind: AdapterKind,
  capabilities: readonly AdapterCapability[],
): AdapterRequirement {
  return {
    kind,
    contractMajor: ADAPTER_CONTRACT_MAJOR,
    capabilities,
    requireProductionProfile: true,
  };
}

export const READINESS_FAILURES = [
  'unhealthy',
  'dependency-unreachable',
  'contract-incompatible',
  'schema-not-current',
  'integrity-unverified',
] as const;

export type ReadinessFailure = (typeof READINESS_FAILURES)[number];

/**
 * Health means the adapter can answer its own diagnostic. Readiness is stricter:
 * Mammoth may accept authoritative work only after every dependency and integrity
 * precondition has been checked successfully.
 */
export interface ProductionLikeHealthProbe {
  readonly health: AdapterDescriptor['health'];
  readonly dependencyReachable: boolean;
  readonly contractCompatible: boolean;
  readonly schemaCurrent: boolean;
  readonly integrityVerified: boolean;
  readonly checkedAt: string;
}

export interface ProductionLikeReadiness {
  readonly ready: boolean;
  readonly checkedAt: string;
  readonly failures: readonly ReadinessFailure[];
}

export function evaluateProductionLikeReadiness(
  probe: ProductionLikeHealthProbe,
): ProductionLikeReadiness {
  const failures: ReadinessFailure[] = [];
  if (probe.health !== 'healthy') failures.push('unhealthy');
  if (!probe.dependencyReachable) failures.push('dependency-unreachable');
  if (!probe.contractCompatible) failures.push('contract-incompatible');
  if (!probe.schemaCurrent) failures.push('schema-not-current');
  if (!probe.integrityVerified) failures.push('integrity-unverified');
  return { ready: failures.length === 0, checkedAt: probe.checkedAt, failures };
}
