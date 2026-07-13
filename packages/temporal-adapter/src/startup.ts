import {
  assertAdapterCompatibility,
  TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT,
  type AdapterCapability,
} from '@mammoth/adapter-contracts';
import type { CommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';
import {
  evaluateTemporalReadiness,
  probeTemporalReadiness,
  temporalAdapterDescriptor,
  type TemporalReadiness,
} from './readiness.js';

export class TemporalStartupError extends Error {
  override readonly name = 'TemporalStartupError';

  constructor(readonly readiness: TemporalReadiness) {
    super(
      `Temporal adapter is not ready: ${readiness.failures.join(', ') || 'unknown failure'}`,
    );
  }
}

export interface TemporalAdapterLifecycle {
  descriptor(): ReturnType<typeof temporalAdapterDescriptor>;
  readiness(): Promise<TemporalReadiness>;
  shutdown(): Promise<void>;
}

export async function assertTemporalStartupReady(options: {
  readonly config: TemporalAdapterConfig;
  readonly runner: CommandRunner;
  readonly requiredCapabilities?: readonly AdapterCapability[];
  readonly requiredContractMajor?: number;
  readonly now?: () => Date;
}): Promise<TemporalReadiness> {
  const probe = await probeTemporalReadiness(options);
  const readiness = evaluateTemporalReadiness(probe);
  const descriptor = temporalAdapterDescriptor({
    config: options.config,
    checkedAt: readiness.checkedAt,
    health: 'healthy',
  });
  assertAdapterCompatibility(
    [descriptor],
    [TEMPORAL_WORKFLOW_RUNTIME_REQUIREMENT],
  );
  if (!readiness.ready) throw new TemporalStartupError(readiness);
  return readiness;
}
