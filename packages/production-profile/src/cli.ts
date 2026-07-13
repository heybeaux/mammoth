#!/usr/bin/env node
import { loadProfileConfig } from './config.js';
import { executeProfileCommand } from './cli-command.js';
import { createProductionProfile } from './profile.js';
import { verifyBackupRestore, verifyLifecycle } from './verify.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadProfileConfig(process.env);
  await executeProfileCommand(command, {
    createProfile: () => createProductionProfile(config, process.env),
    verifyLifecycle: () => verifyLifecycle(config),
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
