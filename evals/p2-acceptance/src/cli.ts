import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyP2 } from './verifier.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const result = await verifyP2(repository);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
