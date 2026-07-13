import { Socket } from 'node:net';
import {
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

export interface TemporalReadinessProbe {
  readonly serviceReachable: boolean;
  readonly namespaceAvailable: boolean;
  readonly namespaceRetentionMatches: boolean;
  readonly taskQueueAvailable: boolean;
  readonly workerCompatible: boolean;
  readonly contractCompatible: boolean;
  readonly missingCapabilities: readonly AdapterCapability[];
  readonly checkedAt: string;
}

export interface TemporalProbeOptions {
  readonly config: TemporalAdapterConfig;
  readonly runner: CommandRunner;
  readonly requiredCapabilities?: readonly AdapterCapability[];
  readonly requiredContractMajor?: number;
  readonly now?: () => Date;
}

export async function probeTemporalReadiness(
  options: TemporalProbeOptions,
): Promise<TemporalReadinessProbe> {
  const requiredCapabilities =
    options.requiredCapabilities ?? TEMPORAL_WORKFLOW_CAPABILITIES;
  const descriptor = temporalAdapterDescriptor({
    config: options.config,
    checkedAt: timestamp(options.now),
    health: 'healthy',
  });
  const serviceReachable = await tcpReachable(
    options.config.host,
    options.config.port,
    options.config.readinessTimeoutMs,
  );
  if (!serviceReachable) {
    return {
      serviceReachable,
      namespaceAvailable: false,
      namespaceRetentionMatches: false,
      taskQueueAvailable: false,
      workerCompatible: false,
      contractCompatible:
        parseMajor(descriptor.contractVersion) ===
        (options.requiredContractMajor ?? ADAPTER_CONTRACT_MAJOR),
      missingCapabilities: missingCapabilities(
        descriptor.capabilities,
        requiredCapabilities,
      ),
      checkedAt: descriptor.checkedAt,
    };
  }
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
  const workerCompatible =
    taskQueueAvailable &&
    outputContainsWorkerIdentity(
      taskQueue.stdout,
      options.config.workflowBundleId,
      options.config.workerBuildId,
    );
  return {
    serviceReachable,
    namespaceAvailable,
    namespaceRetentionMatches,
    taskQueueAvailable,
    workerCompatible,
    contractCompatible:
      parseMajor(descriptor.contractVersion) ===
      (options.requiredContractMajor ?? ADAPTER_CONTRACT_MAJOR),
    missingCapabilities: missingCapabilities(
      descriptor.capabilities,
      requiredCapabilities,
    ),
    checkedAt: descriptor.checkedAt,
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
    capabilities: options.capabilities ?? TEMPORAL_WORKFLOW_CAPABILITIES,
    health: options.health,
    checkedAt: options.checkedAt,
    namespace: options.config.namespace,
    taskQueue: options.config.taskQueue,
    retentionDays: options.config.retentionDays,
    workflowBundleId: options.config.workflowBundleId,
    workerBuildId: options.config.workerBuildId,
  };
}

async function temporalCommand(
  command: string,
  runner: CommandRunner,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return runner.run(command, args, {
    timeoutMs,
    allowFailure: true,
  });
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
