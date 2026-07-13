#!/usr/bin/env node
import { ProcessCommandRunner } from './commands.js';
import { loadTemporalAdapterConfig } from './config.js';
import { TemporalDevServerService } from './service.js';
import { assertTemporalStartupReady } from './startup.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadTemporalAdapterConfig(process.env);
  const runner = new ProcessCommandRunner();
  const service = new TemporalDevServerService(config, runner);
  switch (command) {
    case 'start':
      await service.start();
      break;
    case 'stop':
      await service.stop();
      break;
    case 'status':
      await assertTemporalStartupReady({ config, runner });
      break;
    default:
      throw new Error('usage: mammoth-temporal <start|stop|status>');
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Temporal adapter failed: ${detail}`);
  process.exitCode = 1;
});
