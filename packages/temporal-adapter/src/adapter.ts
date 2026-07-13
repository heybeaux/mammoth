import type {
  WorkflowRuntimeDescriptor,
  WorkflowRuntimeHealth,
} from '@mammoth/adapter-contracts';
import type { CommandRunner } from './commands.js';
import { ProcessCommandRunner } from './commands.js';
import type { TemporalAdapterConfig } from './config.js';
import {
  evaluateTemporalReadiness,
  probeTemporalReadiness,
  temporalAdapterDescriptor,
  type TemporalReadiness,
} from './readiness.js';
import type { TemporalDevServerService } from './service.js';
import { TemporalShutdownError } from './service.js';
import { TemporalStartupError } from './startup.js';

export class TemporalWorkflowRuntimeAdapter {
  private started = false;

  constructor(
    private readonly config: TemporalAdapterConfig,
    private readonly runner: CommandRunner = new ProcessCommandRunner(),
    private readonly service?: TemporalDevServerService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  descriptor(): WorkflowRuntimeDescriptor {
    return temporalAdapterDescriptor({
      config: this.config,
      checkedAt: this.now().toISOString(),
      health: this.started ? 'healthy' : 'unavailable',
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    const readiness = evaluateTemporalReadiness(
      await probeTemporalReadiness({
        config: this.config,
        runner: this.runner,
        now: this.now,
      }),
    );
    if (!readiness.ready) {
      throw new TemporalStartupError(readiness);
    }
    this.started = true;
  }

  async health(): Promise<WorkflowRuntimeHealth> {
    const probe = await probeTemporalReadiness({
      config: this.config,
      runner: this.runner,
      requiredCapabilities: [],
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
        now: this.now,
      }),
    );
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
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
