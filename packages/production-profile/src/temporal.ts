import {
  ProcessCommandRunner,
  assertTemporalStartupReady,
  loadTemporalAdapterConfig,
  type CommandRunner,
  type TemporalAdapterConfig,
  type TemporalReadiness,
} from '@mammoth/temporal-adapter';

export function loadProductionTemporalConfig(
  env: NodeJS.ProcessEnv,
): TemporalAdapterConfig {
  return loadTemporalAdapterConfig(env);
}

export async function assertProductionTemporalReady(
  env: NodeJS.ProcessEnv,
  runner: CommandRunner = new ProcessCommandRunner(),
): Promise<TemporalReadiness> {
  return assertTemporalStartupReady({
    config: loadProductionTemporalConfig(env),
    runner,
  });
}
