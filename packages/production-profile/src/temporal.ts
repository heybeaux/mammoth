import {
  ProcessCommandRunner,
  assertTemporalStartupReady,
  evaluateTemporalReadiness,
  loadTemporalAdapterConfig,
  probeTemporalReadiness,
  type CommandRunner,
  type TemporalAdapterConfig,
  type TemporalReadiness,
  type WorkerBundleManifestProbe,
} from '@mammoth/temporal-adapter';

export function loadProductionTemporalConfig(
  env: NodeJS.ProcessEnv,
): TemporalAdapterConfig {
  return loadTemporalAdapterConfig(env);
}

export async function assertProductionTemporalReady(
  env: NodeJS.ProcessEnv,
  runner: CommandRunner = new ProcessCommandRunner(),
  workerManifestProbe?: WorkerBundleManifestProbe,
): Promise<TemporalReadiness> {
  return assertTemporalStartupReady({
    config: loadProductionTemporalConfig(env),
    runner,
    ...(workerManifestProbe ? { workerManifestProbe } : {}),
  });
}

export async function productionTemporalReadiness(
  env: NodeJS.ProcessEnv,
  runner: CommandRunner = new ProcessCommandRunner(),
  workerManifestProbe?: WorkerBundleManifestProbe,
): Promise<TemporalReadiness> {
  return evaluateTemporalReadiness(
    await probeTemporalReadiness({
      config: loadProductionTemporalConfig(env),
      runner,
      ...(workerManifestProbe ? { workerManifestProbe } : {}),
    }),
  );
}
