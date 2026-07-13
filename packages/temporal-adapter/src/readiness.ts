import { Socket } from 'node:net';
import {
  ADAPTER_CAPABILITIES,
  ADAPTER_CONTRACT_MAJOR,
  ADAPTER_CONTRACT_VERSION,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  type AdapterCapability,
  type WorkflowRuntimeDescriptor,
  type WorkflowRuntimeReadiness,
  type WorkflowRuntimeReadinessFailure,
} from '@mammoth/adapter-contracts';
import type { CommandResult, CommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';

/** Capabilities implemented by this lifecycle package without an SDK worker. */
export const LOCAL_TEMPORAL_ADAPTER_CAPABILITIES = [
  'clean-shutdown',
  'health-reporting',
] as const satisfies readonly AdapterCapability[];

export const TEMPORAL_READINESS_FAILURES = [
  'service-unavailable',
  'namespace-unavailable',
  'namespace-retention-mismatch',
  'task-queue-unavailable',
  'worker-incompatible',
  'contract-version-mismatch',
  'missing-capability',
] as const satisfies readonly WorkflowRuntimeReadinessFailure[];

export type TemporalReadinessFailure =
  (typeof TEMPORAL_READINESS_FAILURES)[number];

export type TemporalReadiness = WorkflowRuntimeReadiness;

export interface WorkerBundleManifest {
  readonly schemaVersion: 1;
  readonly bundleId: string;
  readonly workerBuildId: string;
  readonly taskQueue: string;
  readonly contractMajor: number;
  readonly capabilities: readonly AdapterCapability[];
}

/**
 * Evidence returned by a worker-specific probe. `live` may be true only after
 * the probe challenged the running worker; a checked-in manifest alone is not
 * live readiness evidence.
 */
export interface WorkerBundleManifestEvidence {
  readonly manifest: unknown;
  readonly probedCapabilities: readonly AdapterCapability[];
  readonly live: boolean;
}

export interface WorkerBundleManifestProbe {
  probe(options: {
    readonly config: TemporalAdapterConfig;
    readonly taskQueueDescription: CommandResult;
  }): Promise<WorkerBundleManifestEvidence | undefined>;
}

export interface WorkerBundleManifestEvaluation {
  readonly manifest?: WorkerBundleManifest;
  readonly valid: boolean;
  readonly live: boolean;
  readonly identityMatches: boolean;
  readonly unprovenClaims: readonly AdapterCapability[];
  readonly advertisedCapabilities: readonly AdapterCapability[];
}

export interface TemporalReadinessProbe {
  readonly serviceReachable: boolean;
  readonly namespaceAvailable: boolean;
  readonly namespaceRetentionMatches: boolean;
  readonly taskQueueAvailable: boolean;
  readonly pollerIdentityCompatible: boolean;
  readonly workerManifestValid: boolean;
  readonly workerManifestLive: boolean;
  readonly workerCompatible: boolean;
  readonly contractCompatible: boolean;
  readonly advertisedCapabilities: readonly AdapterCapability[];
  readonly missingCapabilities: readonly AdapterCapability[];
  readonly checkedAt: string;
}

export interface TemporalProbeOptions {
  readonly config: TemporalAdapterConfig;
  readonly runner: CommandRunner;
  readonly workerManifestProbe?: WorkerBundleManifestProbe;
  readonly requiredCapabilities?: readonly AdapterCapability[];
  readonly requiredContractMajor?: number;
  readonly now?: () => Date;
}

export async function probeTemporalReadiness(
  options: TemporalProbeOptions,
): Promise<TemporalReadinessProbe> {
  const requiredCapabilities =
    options.requiredCapabilities ?? TEMPORAL_WORKFLOW_CAPABILITIES;
  const checkedAt = timestamp(options.now);
  const contractCompatible =
    parseMajor(ADAPTER_CONTRACT_VERSION) ===
    (options.requiredContractMajor ?? ADAPTER_CONTRACT_MAJOR);
  const unavailable = {
    serviceReachable: false,
    namespaceAvailable: false,
    namespaceRetentionMatches: false,
    taskQueueAvailable: false,
    pollerIdentityCompatible: false,
    workerManifestValid: false,
    workerManifestLive: false,
    workerCompatible: false,
    contractCompatible,
    advertisedCapabilities: LOCAL_TEMPORAL_ADAPTER_CAPABILITIES,
    missingCapabilities: missingCapabilities(
      LOCAL_TEMPORAL_ADAPTER_CAPABILITIES,
      requiredCapabilities,
    ),
    checkedAt,
  } satisfies TemporalReadinessProbe;

  const serviceReachable = await tcpReachable(
    options.config.host,
    options.config.port,
    options.config.readinessTimeoutMs,
  );
  if (!serviceReachable) return unavailable;

  const namespace = await temporalCommand(
    options.config.cliPath,
    options.runner,
    [
      'operator',
      'namespace',
      'describe',
      '--address',
      options.config.address,
      '--namespace',
      options.config.namespace,
      '--output',
      'json',
    ],
    options.config.readinessTimeoutMs,
  );
  const namespaceAvailable = namespace.exitCode === 0;
  const namespaceRetentionMatches =
    namespaceAvailable &&
    outputContainsRetention(namespace.stdout, options.config.retentionDays);
  const taskQueue = namespaceAvailable
    ? await temporalCommand(
        options.config.cliPath,
        options.runner,
        [
          'task-queue',
          'describe',
          '--address',
          options.config.address,
          '--namespace',
          options.config.namespace,
          '--task-queue',
          options.config.taskQueue,
          '--output',
          'json',
        ],
        options.config.readinessTimeoutMs,
      )
    : undefined;
  const taskQueueAvailable = taskQueue?.exitCode === 0;
  const pollerIdentityCompatible =
    taskQueueAvailable &&
    outputContainsWorkerIdentity(
      taskQueue.stdout,
      options.config.workflowBundleId,
      options.config.workerBuildId,
    );
  const evidence =
    taskQueueAvailable && pollerIdentityCompatible
      ? await options.workerManifestProbe?.probe({
          config: options.config,
          taskQueueDescription: taskQueue,
        })
      : undefined;
  const manifest = evaluateWorkerBundleManifestEvidence(
    evidence,
    options.config,
  );
  const advertisedCapabilities = manifest.advertisedCapabilities;
  const workerCompatible =
    pollerIdentityCompatible &&
    manifest.valid &&
    manifest.live &&
    manifest.identityMatches &&
    manifest.unprovenClaims.length === 0;

  return {
    serviceReachable,
    namespaceAvailable,
    namespaceRetentionMatches,
    taskQueueAvailable,
    pollerIdentityCompatible,
    workerManifestValid: manifest.valid,
    workerManifestLive: manifest.live,
    workerCompatible,
    contractCompatible,
    advertisedCapabilities,
    missingCapabilities: missingCapabilities(
      advertisedCapabilities,
      requiredCapabilities,
    ),
    checkedAt,
  };
}

export function evaluateWorkerBundleManifestEvidence(
  evidence: WorkerBundleManifestEvidence | undefined,
  config: TemporalAdapterConfig,
): WorkerBundleManifestEvaluation {
  if (evidence === undefined) return invalidManifestEvaluation();
  const manifest = parseWorkerBundleManifest(evidence.manifest);
  if (manifest === undefined) return invalidManifestEvaluation();
  const identityMatches =
    manifest.bundleId === config.workflowBundleId &&
    manifest.workerBuildId === config.workerBuildId &&
    manifest.taskQueue === config.taskQueue &&
    manifest.contractMajor === ADAPTER_CONTRACT_MAJOR;
  const unprovenClaims = manifest.capabilities.filter(
    (capability) => !evidence.probedCapabilities.includes(capability),
  );
  const live = evidence.live;
  const workerCapabilities =
    live && identityMatches && unprovenClaims.length === 0
      ? evidence.probedCapabilities.filter((capability) =>
          manifest.capabilities.includes(capability),
        )
      : [];
  return {
    manifest,
    valid: true,
    live,
    identityMatches,
    unprovenClaims,
    advertisedCapabilities: uniqueCapabilities([
      ...LOCAL_TEMPORAL_ADAPTER_CAPABILITIES,
      ...workerCapabilities,
    ]),
  };
}

export function parseWorkerBundleManifest(
  value: unknown,
): WorkerBundleManifest | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  const expected = [
    'bundleId',
    'capabilities',
    'contractMajor',
    'schemaVersion',
    'taskQueue',
    'workerBuildId',
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, i) => key !== expected[i])
  ) {
    return undefined;
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.bundleId !== 'string' ||
    value.bundleId.length === 0 ||
    typeof value.workerBuildId !== 'string' ||
    value.workerBuildId.length === 0 ||
    typeof value.taskQueue !== 'string' ||
    value.taskQueue.length === 0 ||
    !Number.isSafeInteger(value.contractMajor) ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every(isAdapterCapability) ||
    new Set(value.capabilities).size !== value.capabilities.length
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    bundleId: value.bundleId,
    workerBuildId: value.workerBuildId,
    taskQueue: value.taskQueue,
    contractMajor: value.contractMajor as number,
    capabilities: value.capabilities,
  };
}

export function evaluateTemporalReadiness(
  probe: TemporalReadinessProbe,
): TemporalReadiness {
  const failures: TemporalReadinessFailure[] = [];
  if (!probe.serviceReachable) failures.push('service-unavailable');
  if (!probe.namespaceAvailable) failures.push('namespace-unavailable');
  if (probe.namespaceAvailable && !probe.namespaceRetentionMatches) {
    failures.push('namespace-retention-mismatch');
  }
  if (!probe.taskQueueAvailable) failures.push('task-queue-unavailable');
  if (probe.taskQueueAvailable && !probe.workerCompatible) {
    failures.push('worker-incompatible');
  }
  if (!probe.contractCompatible) failures.push('contract-version-mismatch');
  if (probe.missingCapabilities.length > 0) failures.push('missing-capability');
  return {
    ready: failures.length === 0,
    checkedAt: probe.checkedAt,
    failures,
  };
}

export function temporalAdapterDescriptor(options: {
  readonly config: TemporalAdapterConfig;
  readonly checkedAt: string;
  readonly health: WorkflowRuntimeDescriptor['health'];
  readonly capabilities?: readonly AdapterCapability[];
}): WorkflowRuntimeDescriptor {
  return {
    id: `temporal:${options.config.namespace}:${options.config.taskQueue}`,
    kind: 'workflow-runtime',
    contractVersion: ADAPTER_CONTRACT_VERSION,
    implementationVersion: '0.1.0',
    profile: 'production-like-local',
    capabilities: options.capabilities ?? LOCAL_TEMPORAL_ADAPTER_CAPABILITIES,
    health: options.health,
    checkedAt: options.checkedAt,
    namespace: options.config.namespace,
    taskQueue: options.config.taskQueue,
    retentionDays: options.config.retentionDays,
    workflowBundleId: options.config.workflowBundleId,
    workerBuildId: options.config.workerBuildId,
  };
}

function invalidManifestEvaluation(): WorkerBundleManifestEvaluation {
  return {
    valid: false,
    live: false,
    identityMatches: false,
    unprovenClaims: [],
    advertisedCapabilities: LOCAL_TEMPORAL_ADAPTER_CAPABILITIES,
  };
}

function temporalCommand(
  command: string,
  runner: CommandRunner,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return runner.run(command, args, { timeoutMs, allowFailure: true });
}

function outputContainsRetention(output: string, days: number): boolean {
  const normalized = output.toLowerCase().replace(/\s+/g, '');
  const hours = days * 24;
  const seconds = days * 24 * 60 * 60;
  return (
    normalized.includes(`"retentiondays":${String(days)}`) ||
    normalized.includes(`"workflowexecutionretentionttl":"${String(hours)}h`) ||
    normalized.includes(
      `"workflowexecutionretentionttl":"${String(seconds)}s`,
    ) ||
    normalized.includes(`"retention":"${String(days)}d`) ||
    normalized.includes(`retention:${String(days)}d`)
  );
}

function outputContainsWorkerIdentity(
  output: string,
  bundleId: string,
  buildId: string,
): boolean {
  return output.includes(bundleId) && output.includes(buildId);
}

function missingCapabilities(
  actual: readonly AdapterCapability[],
  required: readonly AdapterCapability[],
): AdapterCapability[] {
  return required.filter((capability) => !actual.includes(capability));
}

function uniqueCapabilities(
  capabilities: readonly AdapterCapability[],
): readonly AdapterCapability[] {
  return [...new Set(capabilities)];
}

function isAdapterCapability(value: unknown): value is AdapterCapability {
  return (
    typeof value === 'string' &&
    (ADAPTER_CAPABILITIES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tcpReachable(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      done(true);
    });
    socket.once('error', () => {
      done(false);
    });
    socket.once('timeout', () => {
      done(false);
    });
    socket.connect(port, host);
  });
}

function timestamp(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString();
}

function parseMajor(version: string): number | undefined {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);
  return match ? Number.parseInt(match[1] ?? '', 10) : undefined;
}
