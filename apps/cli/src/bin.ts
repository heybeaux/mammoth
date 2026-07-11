#!/usr/bin/env node
import { executeCli, nodeDependencies } from './operator.js';
import { usage } from './parser.js';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(`${usage()}\n`);
  process.exitCode = 0;
} else {
  process.exitCode = await executeCli(args, nodeDependencies());
}
