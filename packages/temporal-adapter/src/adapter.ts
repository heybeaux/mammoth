import type { AdapterDescriptor } from '@mammoth/adapter-contracts';
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

export class TemporalWorkflowOrchestratorAdapter {
  constructor(
    private readonly config: TemporalAdapterConfig,
    private readonly runner: CommandRunner = new ProcessCommandRunner(),
    private readonly service?: TemporalDevServerService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  descriptor(): AdapterDescriptor {
    return temporalAdapterDescriptor({
      config: this.config,
      checkedAt: this.now().toISOString(),
      health: 'healthy',
    });
  }

  async readiness(): Promise<TemporalReadiness> {
    return evaluateTemporalReadiness(
      await probeTemporalReadiness({
        config: this.config,
        runner: this.runner,
        now: this.now,
      }),
    );
  }

  async shutdown(): Promise<void> {
    await this.service?.stop();
  }
}
