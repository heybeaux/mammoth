import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  patched,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import {
  RESEARCH_PROGRAM_CONTINUE_AS_NEW_POLICY,
  RESEARCH_PROGRAM_WORKFLOW_V1,
  applyWorkflowControlSignal,
  createContinueAsNewCarry,
  deriveWorkflowId,
  supportedWorkflowVersion,
  type ResearchProgramStageId,
  type WorkflowControlSignal,
  type WorkflowControlState,
} from '@mammoth/workflow/p3-contract';
import type {
  PendingHumanGate,
  ResearchProgramActivities,
  ResearchProgramInspection,
  ResearchProgramResult,
  ResearchProgramWorkflowInput,
} from './research-workflow-types.js';

export const RESEARCH_PROGRAM_V1_PATCH = 'research-program-v1-stage-order';

const activities = proxyActivities<ResearchProgramActivities>({
  startToCloseTimeout: '30 seconds',
  heartbeatTimeout: '10 seconds',
  retry: { initialInterval: '250 milliseconds', maximumAttempts: 3 },
});

export const researchProgramControlSignal = defineSignal<
  [WorkflowControlSignal]
>('researchProgram.control.v1');
export const researchProgramStateQuery = defineQuery<ResearchProgramInspection>(
  'researchProgram.state.v1',
);
export const researchProgramDurableStepQuery = defineQuery<
  ResearchProgramStageId | undefined
>('researchProgram.step.v1');
export const researchProgramPendingGatesQuery = defineQuery<
  readonly PendingHumanGate[]
>('researchProgram.gates.v1');
export const researchProgramCancellationQuery = defineQuery<{
  readonly requested: boolean;
  readonly reason?: string;
}>('researchProgram.cancellation.v1');
export const researchProgramRetryQuery = defineQuery<{
  readonly stageId?: ResearchProgramStageId;
  readonly attempt: number;
}>('researchProgram.retry.v1');
export const researchProgramReceiptsQuery = defineQuery<readonly string[]>(
  'researchProgram.receipts.v1',
);

export async function researchProgramWorkflow(
  input: ResearchProgramWorkflowInput,
): Promise<ResearchProgramResult> {
  const definition = supportedWorkflowVersion(
    'research-program',
    input.workflowVersion,
  );
  const expectedWorkflowId = deriveWorkflowId(definition, input.identity);
  if (workflowInfo().workflowId !== expectedWorkflowId) {
    throw new Error('workflow ID does not match the program branch identity');
  }
  // A recorded patch marker freezes the v1 command path for future migrations.
  patched(RESEARCH_PROGRAM_V1_PATCH);

  if ((input.cycle ?? 0) === 0) {
    await activities.ensureResearchProgramControlPlan({
      identity: input.identity,
      ...(input.humanGate === undefined ? {} : { humanGate: input.humanGate }),
    });
  }
  const durable = await activities.loadResearchProgramState(input.identity);
  const humanGate = durable.humanGate;
  let completedStages = [...durable.completedStages];
  let receiptReferences = [
    ...new Set([
      ...durable.receipts.map((receipt) => receipt.receiptId),
      ...(durable.receiptReferences ?? []),
    ]),
  ];
  let durableStep: ResearchProgramStageId | undefined;
  let retry = { ...durable.retry };
  let control: WorkflowControlState = durable.control ?? {
    revision: 0,
    status: 'running',
    processedSignalIds: [],
    activeBranch: { ...(durable.activeBranch ?? input.identity) },
  };
  let cancellationReason: string | undefined;
  let pendingGate: PendingHumanGate | undefined;
  let terminalGateStatus: 'rejected' | 'gate-timeout' | undefined;
  let terminalCompleted = false;
  const cycle = input.cycle ?? 0;
  const cancellationRequested = (): boolean => control.status === 'cancelled';
  let persistedBranch = durable.activeBranch ?? input.identity;
  const persistBranchSelection = async (): Promise<void> => {
    if (
      control.activeBranch.criterionVersion !==
        persistedBranch.criterionVersion ||
      control.activeBranch.branchId !== persistedBranch.branchId
    ) {
      await activities.recordCriterionBranch({
        workflowIdentity: input.identity,
        activeBranch: control.activeBranch,
      });
      persistedBranch = control.activeBranch;
    }
  };

  setHandler(researchProgramControlSignal, (signal) => {
    const application = applyWorkflowControlSignal(control, signal);
    control = application.state;
    if (application.outcome !== 'applied') return;
    if (signal.kind === 'cancel') cancellationReason = signal.reason;
    if (
      signal.kind === 'human-gate-decision' &&
      pendingGate?.gateId === signal.gateId &&
      pendingGate.status === 'pending'
    ) {
      pendingGate = {
        ...pendingGate,
        status: signal.decision === 'approve' ? 'approved' : 'rejected',
        receiptId: signal.receiptId,
      };
    }
  });

  const inspection = (): ResearchProgramInspection => ({
    workflowId: workflowInfo().workflowId,
    runId: workflowInfo().runId,
    workflowVersion: input.workflowVersion,
    cycle,
    revision: control.revision,
    activeBranch: control.activeBranch,
    status:
      control.status === 'cancelled'
        ? 'cancelled'
        : control.status === 'paused'
          ? 'paused'
          : terminalGateStatus !== undefined
            ? 'failed'
            : terminalCompleted
              ? 'completed'
              : pendingGate?.status === 'pending'
                ? 'waiting-human'
                : 'running',
    ...(durableStep === undefined ? {} : { durableStep }),
    completedStages,
    pendingGates: pendingGate?.status === 'pending' ? [pendingGate] : [],
    cancellation: {
      requested: control.status === 'cancelled',
      ...(cancellationReason === undefined
        ? {}
        : { reason: cancellationReason }),
    },
    retry,
    receiptReferences,
    processedSignalIds: control.processedSignalIds,
  });
  setHandler(researchProgramStateQuery, inspection);
  setHandler(researchProgramDurableStepQuery, () => durableStep);
  setHandler(researchProgramPendingGatesQuery, () => inspection().pendingGates);
  setHandler(researchProgramCancellationQuery, () => inspection().cancellation);
  setHandler(researchProgramRetryQuery, () => retry);
  setHandler(researchProgramReceiptsQuery, () => receiptReferences);

  const remaining = RESEARCH_PROGRAM_WORKFLOW_V1.steps.filter(
    (step) => !completedStages.includes(step.stageId),
  );
  let stagesThisRun = 0;
  for (const step of remaining) {
    durableStep = step.stageId;
    await condition(() => control.status !== 'paused');
    if (control.status === 'cancelled') break;

    if (humanGate?.beforeStage === step.stageId && !pendingGate) {
      pendingGate = {
        gateId: humanGate.gateId,
        beforeStage: step.stageId,
        status: 'pending',
      };
      const decided = await condition(
        () => pendingGate?.status !== 'pending' || cancellationRequested(),
        humanGate.timeoutMs,
      );
      if (cancellationRequested()) break;
      if (!decided) {
        pendingGate = { ...pendingGate, status: 'expired' };
        terminalGateStatus = 'gate-timeout';
        break;
      }
      if (pendingGate.receiptId) {
        await activities.recordHumanGateDecision({
          identity: input.identity,
          gateId: pendingGate.gateId,
          decision: pendingGate.status === 'rejected' ? 'reject' : 'approve',
          receiptId: pendingGate.receiptId,
        });
        receiptReferences.push(pendingGate.receiptId);
      }
      if (pendingGate.status === 'rejected') {
        terminalGateStatus = 'rejected';
        break;
      }
      await condition(() => control.status !== 'paused');
      if (cancellationRequested()) break;
    }

    await persistBranchSelection();
    retry = { stageId: step.stageId, attempt: 1 };
    const receipt = await activities.executeResearchStage({
      identity: input.identity,
      workflowVersion: input.workflowVersion,
      stageId: step.stageId,
    });
    completedStages = [...completedStages, step.stageId];
    receiptReferences = [...receiptReferences, receipt.receiptId];
    retry = { attempt: 0 };
    stagesThisRun += 1;

    if (
      completedStages.length < RESEARCH_PROGRAM_WORKFLOW_V1.steps.length &&
      stagesThisRun >= RESEARCH_PROGRAM_CONTINUE_AS_NEW_POLICY.maxCyclesPerRun
    ) {
      await activities.saveResearchProgramControlState({
        identity: input.identity,
        control,
      });
      createContinueAsNewCarry(definition, input.identity);
      await continueAsNew<typeof researchProgramWorkflow>({
        identity: input.identity,
        workflowVersion: input.workflowVersion,
        cycle: cycle + 1,
      });
    }
  }

  const status =
    control.status === 'cancelled'
      ? 'cancelled'
      : (terminalGateStatus ?? 'completed');
  terminalCompleted = status === 'completed';
  if (status !== 'completed') {
    const termination = await activities.recordResearchProgramTermination({
      identity: input.identity,
      status,
      completedStages,
      receiptReferences,
      ...(cancellationReason === undefined
        ? {}
        : { reason: cancellationReason }),
    });
    receiptReferences = [...receiptReferences, termination.receiptId];
  }
  return {
    status,
    workflowId: workflowInfo().workflowId,
    completedStages,
    activeBranch: control.activeBranch,
    receiptReferences,
    partial: status !== 'completed',
    ...(status === 'cancelled' && cancellationReason !== undefined
      ? { reason: cancellationReason }
      : {}),
  };
}
