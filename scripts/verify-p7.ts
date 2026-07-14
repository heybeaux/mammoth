import { resolve } from 'node:path';
import { verifyP7 } from '../evals/p7-acceptance/src/verifier.js';

try {
  const result = await verifyP7(resolve(process.cwd()));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      verifier: 'mammoth-p7-acceptance-v1',
      failure: 'P7_VERIFIER_UNEXPECTED',
    })}\n`,
  );
  process.exitCode = 1;
}
