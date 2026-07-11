import { resolve } from 'node:path';
import { verifyP2 } from '../evals/p2-acceptance/src/verifier.js';

const result = await verifyP2(resolve(process.cwd()));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
