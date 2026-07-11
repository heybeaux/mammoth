import { verifyRuntimeBridge } from './verify-runtime.js';

try {
  const result = await verifyRuntimeBridge(process.argv[2], process.argv[3]);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
