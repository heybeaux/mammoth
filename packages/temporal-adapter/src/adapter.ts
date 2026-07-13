import type {
  AdapterCapability,
  WorkflowRuntimeDescriptor,
  WorkflowRuntimeHealth,
} from '@mammoth/adapter-contracts';
import type { CommandRunner } from './commands.js';
import { ProcessCommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';
import {
  LOCAL_TEMPORAL_ADAPTER_CAPABILITIES,
  evaluateTemporalReadiness,
  probeTemporalReadiness,
  temporalAdapterDescriptor,
  type TemporalReadiness,
  type WorkerBundleManifestProbe,
} from './readiness.js';
import type { TemporalDevServerService } from './service.js';
import { TemporalShutdownError } from './service.js';
import { TemporalStartupError } from './startup.js';

export class TemporalWorkflowRuntimeAdapter {
  private started = false;
  private discoveredCapabilities: readonly AdapterCapability[] =
    LOCAL_TEMPORAL_ADAPTER_CAPABILITIES;

  constructor(
    private readonly config: TemporalAdapterConfig,
    private readonly runner: CommandRunner = new ProcessCommandRunner(),
    private readonly service?: TemporalDevServerService,
    private readonly now: () => Date = () => new Date(),
    private readonly workerManifestProbe?: WorkerBundleManifestProbe,
  ) {}

  descriptor(): WorkflowRuntimeDescriptor {
    return temporalAdapterDescriptor({
      config: this.config,
      checkedAt: this.now().toISOString(),
      health: this.started ? 'healthy' : 'unavailable',
      capabilities: this.discoveredCapabilities,
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    const probe = await probeTemporalReadiness({
      config: this.config,
      runner: this.runner,
      ...(this.workerManifestProbe === undefined
        ? {}
        : { workerManifestProbe: this.workerManifestProbe }),
      now: this.now,
    });
    const readiness = evaluateTemporalReadiness(probe);
    if (!readiness.ready) {
      throw new TemporalStartupError(readiness);
    }
    this.discoveredCapabilities = probe.advertisedCapabilities;
    this.started = true;
  }

  async health(): Promise<WorkflowRuntimeHealth> {
    const probe = await probeTemporalReadiness({
      config: this.config,
      runner: this.runner,
      requiredCapabilities: [],
      ...(this.workerManifestProbe === undefined
        ? {}
        : { workerManifestProbe: this.workerManifestProbe }),
      now: this.now,
    });
    return {
      health: probe.serviceReachable ? 'healthy' : 'unavailable',
      checkedAt: probe.checkedAt,
    };
  }

  async readiness(): Promise<TemporalReadiness> {
    if (!this.started) {
      return {
        ready: false,
        checkedAt: this.now().toISOString(),
        failures: ['not-started'],
      };
    }
    return evaluateTemporalReadiness(
      await probeTemporalReadiness({
        config: this.config,
        runner: this.runner,
        ...(this.workerManifestProbe === undefined
          ? {}
          : { workerManifestProbe: this.workerManifestProbe }),
        now: this.now,
      }),
    );
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.discoveredCapabilities = LOCAL_TEMPORAL_ADAPTER_CAPABILITIES;
    if (!this.service) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.service.stop(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new TemporalShutdownError(this.config.shutdownTimeoutMs));
          }, this.config.shutdownTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
