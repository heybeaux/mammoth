#!/usr/bin/env node
import { executeCli, nodeDependencies } from './operator.js';
import { executeLocalP7ResearchCli } from './p7-local.js';
import { usage } from './parser.js';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`${usage()}\n`);
  process.exitCode = 0;
} else if (args[0] === 'research') {
  process.exitCode = await executeLocalP7ResearchCli(args, process.env, {
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
  });
} else {
  if (process.env.MAMMOTH_WORKFLOW_BACKEND === 'temporal') {
    const { executeNodeTemporalCli } = await import('./temporal-operator.js');
    process.exitCode = await executeNodeTemporalCli(args, {
      stdout: (value) => process.stdout.write(`${value}\n`),
      stderr: (value) => process.stderr.write(`${value}\n`),
    });
  } else {
    process.exitCode = await executeCli(args, nodeDependencies());
  }
}
