import { Connection, Client } from '@temporalio/client';

const [command, address, namespace, taskQueue, workflowId, payload] =
  process.argv.slice(2);
if (!command || !address || !namespace || !taskQueue || !workflowId) {
  throw new Error(
    'usage: recovery-probe-client <start|query|signal|result> <address> <namespace> <task-queue> <workflow-id> [json]',
  );
}

const connection = await Connection.connect({ address });
const client = new Client({ connection, namespace });
try {
  const handle = client.workflow.getHandle(workflowId);
  let result: unknown;
  if (command === 'start') {
    const started = await client.workflow.start(
      'temporalProcessRecoveryProbeWorkflow',
      {
        workflowId,
        taskQueue,
        args: [parsePayload(payload)],
      },
    );
    result = { workflowId, runId: started.firstExecutionRunId };
  } else if (command === 'query') {
    result = await handle.query('recoveryState');
  } else if (command === 'signal') {
    await handle.signal('recoveryAdvance', parsePayload(payload));
    result = { signalled: true };
  } else if (command === 'result') {
    result = await handle.result();
  } else {
    throw new Error(`unknown recovery client command: ${command}`);
  }
  console.log(`MAMMOTH_RECOVERY_CLIENT_RESULT:${JSON.stringify(result)}`);
} finally {
  await connection.close();
}

function parsePayload(value: string | undefined): unknown {
  if (value === undefined)
    throw new Error('recovery client payload is required');
  return JSON.parse(value) as unknown;
}
