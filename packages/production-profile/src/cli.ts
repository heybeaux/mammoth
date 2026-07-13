#!/usr/bin/env node
import { loadProfileConfig } from './config.js';
import { createProductionProfile } from './profile.js';
import { verifyBackupRestore, verifyLifecycle } from './verify.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadProfileConfig(process.env);
  const profile = createProductionProfile(config, process.env);
  switch (command) {
    case 'bootstrap':
      await profile.bootstrap();
      break;
    case 'start':
      console.log(JSON.stringify(await profile.start(), null, 2));
      break;
    case 'stop':
      await profile.stop();
      break;
    case 'kill':
      await profile.kill();
      break;
    case 'status': {
      const status = await profile.assertReady();
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case 'verify-lifecycle':
      console.log(
        JSON.stringify(
          await profile.runVerified(() => verifyLifecycle(config)),
          null,
          2,
        ),
      );
      break;
    case 'verify-backup':
      console.log(
        JSON.stringify(
          await profile.runVerified(() => verifyBackupRestore(config)),
          null,
          2,
        ),
      );
      break;
    default:
      throw new Error(
        'usage: mammoth-profile <bootstrap|start|stop|kill|status|verify-lifecycle|verify-backup>',
      );
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`production profile failed: ${detail}`);
  process.exitCode = 1;
});
