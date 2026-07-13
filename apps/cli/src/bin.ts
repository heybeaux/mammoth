#!/usr/bin/env node
import { executeCli, nodeDependencies } from './operator.js';
import { usage } from './parser.js';
import { executeNodeTemporalCli } from './temporal-operator.js';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`${usage()}\n`);
  process.exitCode = 0;
} else {
  process.exitCode =
    process.env.MAMMOTH_WORKFLOW_BACKEND === 'temporal'
      ? await executeNodeTemporalCli(args, {
          stdout: (value) => process.stdout.write(`${value}\n`),
          stderr: (value) => process.stderr.write(`${value}\n`),
        })
      : await executeCli(args, nodeDependencies());
}
