import { resolve } from 'node:path';
import { verifyP3 } from '../evals/p3-acceptance/src/verifier.js';

const result = await verifyP3(resolve(process.cwd()));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
