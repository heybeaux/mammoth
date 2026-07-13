#!/usr/bin/env node
import { loadProfileConfig } from './config.js';
import { executeProfileCommand } from './cli-command.js';
import { createProductionProfile } from './profile.js';
import {
  verifyBackupRestore,
  verifyLifecycle,
  verifyP4Lifecycle,
  verifyP5Lifecycle,
} from './verify.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadProfileConfig(process.env);
  await executeProfileCommand(command, {
    createProfile: () => createProductionProfile(config, process.env),
    verifyLifecycle: () => verifyLifecycle(config),
    verifyP4: () => verifyP4Lifecycle(config),
    verifyP5: () => verifyP5Lifecycle(config),
    verifyBackup: () => verifyBackupRestore(config),
    write: (value) => {
      console.log(JSON.stringify(value, null, 2));
    },
  });
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`production profile failed: ${detail}`);
  process.exitCode = 1;
});
