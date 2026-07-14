import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import {
  deriveP7ResearchRunId,
  type P7ResearchStatus,
} from '@mammoth/workflow';
import { carryFrom, executeP7ResearchShell } from './p7-workflow-shell.js';
import {
  P7_MODEL_PROVIDER_TASK_QUEUE,
  type P7LiveResearchWorkflowInput,
  type P7ResearchActivities,
  type P7ResearchControlSignal,
  type P7ResearchWorkflowResult,
} from './p7-workflow-types.js';

export const p7ResearchStateQuery = defineQuery<P7ResearchStatus>(
  'p7Research.state.v1',
);

export const p7ResearchControlSignal = defineSignal<[P7ResearchControlSignal]>(
  'p7Research.control.v1',
);

const activities = proxyActivities<P7ResearchActivities>({
  taskQueue: P7_MODEL_PROVIDER_TASK_QUEUE,
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '15 seconds',
  retry: { initialInterval: '1 second', maximumAttempts: 1 },
});

export async function p7LiveResearchWorkflow(
  input: P7LiveResearchWorkflowInput,
): Promise<P7ResearchWorkflowResult> {
  const runId = deriveP7ResearchRunId(input.request);
  if (workflowInfo().workflowId !== runId)
    throw new Error('P7 workflow ID does not match stable research identity');

  let status: P7ResearchStatus = input.carry
    ? statusFromCarry(runId, input.carry)
    : {
        runId,
        state: 'accepted',
        authoritativeRevision: 0,
        completedCellIds: [],
        failedCellIds: [],
        cancelledCellIds: [],
        unresolvedCellIds: input.cells.map(({ cellId }) => cellId),
        receiptIds: [],
      };
  const processedSignalIds = new Set(input.carry?.processedSignalIds ?? []);
  let resumeRequested = false;
  const control: { cancellationReason?: string } = {};

  setHandler(p7ResearchStateQuery, () => status);
  setHandler(p7ResearchControlSignal, (signal) => {
    if (processedSignalIds.has(signal.signalId)) return;
    if (signal.expectedRevision !== status.authoritativeRevision)
      throw new Error('P7 control signal revision conflict');
    processedSignalIds.add(signal.signalId);
    if (signal.kind === 'resume') resumeRequested = true;
    else control.cancellationReason = signal.reason;
  });

  while (true) {
    status = { ...status, state: 'running' };
    const result = await executeP7ResearchShell(
      {
        ...input,
        carry: {
          ...carryFrom(status),
          processedSignalIds: [...processedSignalIds],
        },
      },
      activities,
      control,
    );
    status = result;

    if (result.state === 'running') {
      await continueAsNew<typeof p7LiveResearchWorkflow>({
        ...input,
        carry: {
          ...carryFrom(result),
          processedSignalIds: [...processedSignalIds],
        },
      });
    }
    if (result.state !== 'partial' || result.unresolvedCellIds.length === 0)
      return result;

    await condition(
      () => resumeRequested || control.cancellationReason !== undefined,
    );
    if (control.cancellationReason !== undefined) continue;
    resumeRequested = false;
    status = {
      ...status,
      state: 'running',
      failedCellIds: status.failedCellIds.filter(
        (cellId) => !status.unresolvedCellIds.includes(cellId),
      ),
    };
  }
}

function statusFromCarry(
  runId: string,
  carry: NonNullable<P7LiveResearchWorkflowInput['carry']>,
): P7ResearchStatus {
  return {
    runId,
    state: 'running',
    authoritativeRevision: carry.authoritativeRevision,
    completedCellIds: [...carry.completedCellIds],
    failedCellIds: [...carry.failedCellIds],
    cancelledCellIds: [...carry.cancelledCellIds],
    unresolvedCellIds: [...carry.unresolvedCellIds],
    receiptIds: [...carry.receiptIds],
  };
}
