import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './recovery-probe-activities.js';

const [mode, address, namespace, taskQueue] = process.argv.slice(2);
if (
  (mode !== 'workflow' && mode !== 'activity') ||
  !address ||
  !namespace ||
  !taskQueue
) {
  throw new Error(
    'usage: recovery-probe-worker <workflow|activity> <address> <namespace> <task-queue>',
  );
}

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue,
  identity: `mammoth-recovery-${mode}-${String(process.pid)}`,
  ...(mode === 'workflow'
    ? {
        workflowsPath: fileURLToPath(
          new URL('./recovery-probe-workflows.ts', import.meta.url),
        ),
      }
    : { activities }),
});

console.log(`MAMMOTH_RECOVERY_WORKER_READY:${mode}`);
try {
  await worker.run();
} finally {
  await connection.close();
}
