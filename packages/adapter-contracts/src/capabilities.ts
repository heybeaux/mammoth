export const ADAPTER_KINDS = [
  'workflow-runtime',
  'workflow-store',
  'epistemic-ledger',
  'work-state-store',
  'artifact-store',
  'side-effect-executor',
  'receipt-writer',
] as const;

export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const ADAPTER_CAPABILITIES = [
  'atomic-transactions',
  'cross-process-fencing',
  'durable-restart',
  'deterministic-replay',
  'durable-timers',
  'signals',
  'queries',
  'retry-scheduling',
  'continue-as-new',
  'task-queue-polling',
  'clean-shutdown',
  'content-verification',
  'provider-idempotency',
  'cooperative-cancellation',
  'health-reporting',
] as const;

export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];

export interface AdapterDescriptor {
  readonly id: string;
  readonly kind: AdapterKind;
  readonly contractVersion: string;
  readonly implementationVersion: string;
  readonly profile: 'local' | 'production-like-local';
  readonly capabilities: readonly AdapterCapability[];
  readonly health: 'healthy' | 'degraded' | 'unavailable';
  readonly checkedAt: string;
}

export interface AdapterRequirement {
  readonly kind: AdapterKind;
  readonly contractMajor: number;
  readonly capabilities: readonly AdapterCapability[];
  readonly requireProductionProfile?: boolean;
}

export interface AdapterCompatibilityIssue {
  readonly kind: AdapterKind;
  readonly code:
    | 'missing-adapter'
    | 'contract-version-mismatch'
    | 'missing-capability'
    | 'invalid-profile'
    | 'unhealthy';
  readonly detail: string;
}

export class AdapterCompatibilityError extends Error {
  public constructor(
    public readonly issues: readonly AdapterCompatibilityIssue[],
  ) {
    super(
      `adapter compatibility failed: ${issues
        .map((issue) => `${issue.kind}:${issue.code}`)
        .join(', ')}`,
    );
    this.name = 'AdapterCompatibilityError';
  }
}

export function assertAdapterCompatibility(
  descriptors: readonly AdapterDescriptor[],
  requirements: readonly AdapterRequirement[],
): void {
  const issues: AdapterCompatibilityIssue[] = [];
  for (const requirement of requirements) {
    const descriptor = descriptors.find(
      (candidate) => candidate.kind === requirement.kind,
    );
    if (!descriptor) {
      issues.push({
        kind: requirement.kind,
        code: 'missing-adapter',
        detail: `no ${requirement.kind} adapter is configured`,
      });
      continue;
    }
    const contractMajor = parseMajor(descriptor.contractVersion);
    if (contractMajor !== requirement.contractMajor) {
      issues.push({
        kind: requirement.kind,
        code: 'contract-version-mismatch',
        detail: `requires contract major ${String(requirement.contractMajor)}, received ${descriptor.contractVersion}`,
      });
    }
    if (
      requirement.requireProductionProfile === true &&
      descriptor.profile !== 'production-like-local'
    ) {
      issues.push({
        kind: requirement.kind,
        code: 'invalid-profile',
        detail: `requires production-like-local, received ${descriptor.profile}`,
      });
    }
    if (descriptor.health !== 'healthy') {
      issues.push({
        kind: requirement.kind,
        code: 'unhealthy',
        detail: `adapter health is ${descriptor.health}`,
      });
    }
    for (const capability of requirement.capabilities) {
      if (!descriptor.capabilities.includes(capability)) {
        issues.push({
          kind: requirement.kind,
          code: 'missing-capability',
          detail: `missing capability ${capability}`,
        });
      }
    }
  }
  if (issues.length > 0) throw new AdapterCompatibilityError(issues);
}

function parseMajor(version: string): number | undefined {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);
  return match ? Number.parseInt(match[1] ?? '', 10) : undefined;
}
