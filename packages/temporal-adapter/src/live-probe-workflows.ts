import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import type { WorkerBundleManifest } from './readiness.js';
import type {
  TemporalCancellationProbeInput,
  TemporalCancellationProbeResult,
  TemporalLiveProbeInput,
  TemporalLiveProbeResult,
} from './live-probe-types.js';

interface ProbeActivities {
  retryProbeActivity(challengeId: string): Promise<string>;
}

const probeActivities = proxyActivities<ProbeActivities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    initialInterval: '10 milliseconds',
    maximumAttempts: 2,
  },
});

export const liveProbeManifestQuery =
  defineQuery<WorkerBundleManifest>('liveProbeManifest');
export const liveProbeSignal =
  defineSignal<[challengeId: string]>('liveProbeSignal');

export async function temporalReadinessProbeWorkflow(
  input: TemporalLiveProbeInput,
): Promise<TemporalLiveProbeResult> {
  let signalObserved = input.signalObserved;
  setHandler(liveProbeManifestQuery, () => input.manifest);
  setHandler(liveProbeSignal, (challengeId) => {
    if (challengeId === input.challengeId) signalObserved = true;
  });

  if (!signalObserved) {
    await condition(() => signalObserved, '5 seconds');
  }

  if (input.cycle === 0) {
    await continueAsNew<typeof temporalReadinessProbeWorkflow>({
      ...input,
      cycle: 1,
      signalObserved,
    });
  }

  const activityResult = await probeActivities.retryProbeActivity(
    input.challengeId,
  );
  await sleep(10);
  return {
    manifest: input.manifest,
    challengeId: input.challengeId,
    cycle: input.cycle,
    observed: {
      continuedAsNew: input.cycle === 1,
      signal: signalObserved,
      timer: true,
      retry: activityResult.endsWith(':2'),
      activityResult,
    },
  };
}

export async function temporalCancellationProbeWorkflow(
  input: TemporalCancellationProbeInput,
): Promise<TemporalCancellationProbeResult> {
  try {
    await sleep('1 hour');
    return { challengeId: input.challengeId, cancellationObserved: false };
  } catch (error: unknown) {
    if (isCancellation(error)) {
      return { challengeId: input.challengeId, cancellationObserved: true };
    }
    throw error;
  }
}
