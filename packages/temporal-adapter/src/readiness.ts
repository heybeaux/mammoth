import { Socket } from 'node:net';
import {
  ADAPTER_CONTRACT_MAJOR,
  ADAPTER_CONTRACT_VERSION,
  TEMPORAL_WORKFLOW_CAPABILITIES,
  type AdapterCapability,
  type AdapterDescriptor,
} from '@mammoth/adapter-contracts';
import type { CommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';

export const TEMPORAL_READINESS_FAILURES = [
  'service-unreachable',
  'namespace-unavailable',
  'task-queue-unavailable',
  'contract-incompatible',
  'missing-capability',
] as const;

export type TemporalReadinessFailure =
  (typeof TEMPORAL_READINESS_FAILURES)[number];

export interface TemporalReadiness {
  readonly ready: boolean;
  readonly checkedAt: string;
  readonly failures: readonly TemporalReadinessFailure[];
}

export interface TemporalReadinessProbe {
  readonly serviceReachable: boolean;
  readonly namespaceAvailable: boolean;
  readonly taskQueueAvailable: boolean;
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
      taskQueueAvailable: false,
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
  const namespaceAvailable = await temporalCommandSucceeds(
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
    ],
  );
  const taskQueueAvailable = namespaceAvailable
    ? await temporalCommandSucceeds(options.config.cliPath, options.runner, [
        'task-queue',
        'describe',
        '--address',
        options.config.address,
        '--namespace',
        options.config.namespace,
        '--task-queue',
        options.config.taskQueue,
      ])
    : false;
  return {
    serviceReachable,
    namespaceAvailable,
    taskQueueAvailable,
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
  if (!probe.serviceReachable) failures.push('service-unreachable');
  if (!probe.namespaceAvailable) failures.push('namespace-unavailable');
  if (!probe.taskQueueAvailable) failures.push('task-queue-unavailable');
  if (!probe.contractCompatible) failures.push('contract-incompatible');
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
  readonly health: AdapterDescriptor['health'];
  readonly capabilities?: readonly AdapterCapability[];
}): AdapterDescriptor {
  return {
    id: `temporal:${options.config.namespace}:${options.config.taskQueue}`,
    kind: 'workflow-orchestrator',
    contractVersion: ADAPTER_CONTRACT_VERSION,
    implementationVersion: '0.1.0',
    profile: 'production-like-local',
    capabilities: options.capabilities ?? TEMPORAL_WORKFLOW_CAPABILITIES,
    health: options.health,
    checkedAt: options.checkedAt,
  };
}

async function temporalCommandSucceeds(
  command: string,
  runner: CommandRunner,
  args: readonly string[],
): Promise<boolean> {
  const result = await runner.run(command, args, {
    timeoutMs: 5_000,
    allowFailure: true,
  });
  return result.exitCode === 0;
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
