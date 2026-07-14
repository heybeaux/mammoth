import { resolve } from 'node:path';
import { verifyP6 } from '../evals/p6-acceptance/src/verifier.js';

const result = await verifyP6(resolve(process.cwd()));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
