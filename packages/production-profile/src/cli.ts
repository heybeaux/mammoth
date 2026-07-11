#!/usr/bin/env node
import { loadProfileConfig } from './config.js';
import { NativePostgresService } from './service.js';
import { verifyBackupRestore, verifyLifecycle } from './verify.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadProfileConfig(process.env);
  const service = new NativePostgresService(config);
  switch (command) {
    case 'start':
      await service.start();
      break;
    case 'stop':
      await service.stop();
      break;
    case 'kill':
      await service.kill();
      break;
    case 'status':
      if (!(await service.ready()))
        throw new Error(
          `profile is not ready at ${config.host}:${String(config.port)}`,
        );
      break;
    case 'verify-lifecycle':
      console.log(JSON.stringify(await verifyLifecycle(config), null, 2));
      break;
    case 'verify-backup':
      console.log(JSON.stringify(await verifyBackupRestore(config), null, 2));
      break;
    default:
      throw new Error(
        'usage: mammoth-profile <start|stop|kill|status|verify-lifecycle|verify-backup>',
      );
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`production profile failed: ${detail}`);
  process.exitCode = 1;
});
