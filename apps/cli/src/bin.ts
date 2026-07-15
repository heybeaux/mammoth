#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { executeCli, nodeDependencies } from './operator.js';
import { executeLocalP7ResearchCli } from './p7-local.js';
import { executeP8ResearchCli } from './p8-operator.js';
import { executeP9ResearchCli } from './p9-operator.js';
import { usage } from './parser.js';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`${usage()}\n`);
  process.exitCode = 0;
} else if (args[0] === 'research') {
  if (isP9Command(args)) {
    process.exitCode = await executeP9ResearchCli(args, {
      stdout: (value) => process.stdout.write(`${value}\n`),
      stderr: (value) => process.stderr.write(`${value}\n`),
    });
  } else if (
    args[1] === 'ask' ||
    args[1] === 'init' ||
    args[1] === 'up' ||
    args[1] === 'doctor' ||
    isP8BundleCommand(args)
  ) {
    process.exitCode = await executeP8ResearchCli(args, {
      stdout: (value) => process.stdout.write(`${value}\n`),
      stderr: (value) => process.stderr.write(`${value}\n`),
    });
  } else {
    process.exitCode = await executeLocalP7ResearchCli(args, process.env, {
      stdout: (value) => process.stdout.write(`${value}\n`),
      stderr: (value) => process.stderr.write(`${value}\n`),
    });
  }
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

function isP9Command(args: readonly string[]): boolean {
  const command = args[1];
  if (
    command === 'plan' ||
    command === 'preview' ||
    command === 'accept' ||
    command === 'revise'
  ) {
    return true;
  }
  if (command === 'doctor') return args.includes('--p9');
  if (command !== 'run' && command !== 'inspect') return false;
  const subject = args[2];
  if (!subject || subject.startsWith('-')) return false;
  const resolved = resolve(process.cwd(), subject);
  if (basename(resolved) === 'research-plan.json') return true;
  if (command === 'run')
    return existsSync(join(resolved, 'research-plan.json'));
  return existsSync(join(resolved, 'execution-receipt.json'));
}

function isP8BundleCommand(args: readonly string[]): boolean {
  const command = args[1];
  if (
    command !== 'status' &&
    command !== 'inspect' &&
    command !== 'resume' &&
    command !== 'cancel' &&
    command !== 'export'
  ) {
    return false;
  }
  const subject = args[2];
  if (!subject || subject.startsWith('-')) return false;
  if (subject.startsWith('p8-run:')) return true;
  return existsSync(
    join(resolve(process.cwd(), subject), 'report-manifest.json'),
  );
}
