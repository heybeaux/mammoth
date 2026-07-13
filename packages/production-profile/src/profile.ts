import {
  ProcessCommandRunner,
  TemporalDevServerService,
  type CommandRunner,
  type TemporalReadiness,
  type WorkerBundleManifestProbe,
} from '@mammoth/temporal-adapter';
import type { ProfileConfig } from './config.js';
import { NativePostgresService } from './service.js';
import {
  loadProductionTemporalConfig,
  productionTemporalReadiness,
} from './temporal.js';

export interface ProfilePostgresService {
  start(): Promise<void>;
  stop(): Promise<void>;
  kill(): Promise<void>;
  ready(): Promise<boolean>;
}

export interface ProfileTemporalService {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ProductionProfileStatus {
  readonly ready: boolean;
  readonly postgres: { readonly ready: boolean };
  readonly temporal: {
    readonly ready: boolean;
    readonly failures: readonly string[];
  };
}

export interface ProductionProfileDependencies {
  readonly postgres: ProfilePostgresService;
  readonly temporal: ProfileTemporalService;
  readonly temporalReadiness: () => Promise<TemporalReadiness>;
}

export class ProductionProfileNotReadyError extends Error {
  override readonly name = 'ProductionProfileNotReadyError';

  constructor(readonly status: ProductionProfileStatus) {
    const failures = [
      ...(status.postgres.ready ? [] : ['postgres-unavailable']),
      ...status.temporal.failures.map((failure) => `temporal:${failure}`),
    ];
    super(`production profile is not ready: ${failures.join(', ')}`);
  }
}

/**
 * Owns backing-service order only. A compatible Temporal worker is an external
 * process until the worker package exists; readiness still requires its poller.
 */
export class ProductionProfile {
  constructor(private readonly dependencies: ProductionProfileDependencies) {}

  /** Starts Postgres, then the local Temporal service and explicit namespace. */
  async bootstrap(): Promise<void> {
    await this.dependencies.postgres.start();
    try {
      await this.dependencies.temporal.start();
    } catch (error) {
      await this.dependencies.temporal.stop();
      await this.dependencies.postgres.stop().catch(() => undefined);
      throw error;
    }
  }

  /** Starts backing services and succeeds only when the compatible worker polls. */
  async start(): Promise<ProductionProfileStatus> {
    await this.bootstrap();
    try {
      return await this.assertReady();
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async status(): Promise<ProductionProfileStatus> {
    const postgresReady = await this.dependencies.postgres.ready();
    let temporal: ProductionProfileStatus['temporal'];
    try {
      const readiness = await this.dependencies.temporalReadiness();
      temporal = {
        ready: readiness.ready,
        failures: readiness.failures,
      };
    } catch (error) {
      temporal = {
        ready: false,
        failures: [`probe-failed:${errorDetail(error)}`],
      };
    }
    return {
      ready: postgresReady && temporal.ready,
      postgres: { ready: postgresReady },
      temporal,
    };
  }

  async assertReady(): Promise<ProductionProfileStatus> {
    const status = await this.status();
    if (!status.ready) throw new ProductionProfileNotReadyError(status);
    return status;
  }

  /** Stops the bounded Temporal service before authoritative Postgres. */
  async stop(): Promise<void> {
    await this.dependencies.temporal.stop();
    await this.dependencies.postgres.stop();
  }

  /** Temporal still shuts down cleanly before the Postgres crash boundary. */
  async kill(): Promise<void> {
    await this.dependencies.temporal.stop();
    await this.dependencies.postgres.kill();
  }

  /** A verifier cannot execute or print evidence until composition is ready. */
  async runVerified<T>(operation: () => Promise<T>): Promise<T> {
    await this.start();
    try {
      return await operation();
    } finally {
      await this.stop();
    }
  }
}

export function createProductionProfile(
  config: ProfileConfig,
  env: NodeJS.ProcessEnv,
  runner: CommandRunner = new ProcessCommandRunner(),
  workerManifestProbe?: WorkerBundleManifestProbe,
): ProductionProfile {
  const temporalConfig = loadProductionTemporalConfig(env);
  return new ProductionProfile({
    postgres: new NativePostgresService(config),
    temporal: new TemporalDevServerService(temporalConfig, runner),
    temporalReadiness: () =>
      productionTemporalReadiness(env, runner, workerManifestProbe),
  });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
