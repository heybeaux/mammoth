import type { ProductionProfile, ProductionProfileStatus } from './profile.js';

export type ProductionProfileCommand =
  | 'bootstrap'
  | 'start'
  | 'stop'
  | 'kill'
  | 'status'
  | 'verify-lifecycle'
  | 'verify-backup';

export interface ProfileCommandOperations {
  readonly createProfile: () => Pick<
    ProductionProfile,
    'bootstrap' | 'start' | 'stop' | 'kill' | 'assertReady'
  >;
  readonly verifyLifecycle: () => Promise<unknown>;
  readonly verifyBackup: () => Promise<unknown>;
  readonly write: (value: unknown) => void;
}

/**
 * Keeps the P2 Postgres/CAS verifiers independent from the P3 Temporal-aware
 * operational profile. The profile factory is deliberately lazy so verifier
 * commands do not even load Temporal configuration or construct its service.
 */
export async function executeProfileCommand(
  command: string | undefined,
  operations: ProfileCommandOperations,
): Promise<void> {
  switch (command as ProductionProfileCommand | undefined) {
    case 'verify-lifecycle':
      operations.write(await operations.verifyLifecycle());
      return;
    case 'verify-backup':
      operations.write(await operations.verifyBackup());
      return;
    case 'bootstrap':
      await operations.createProfile().bootstrap();
      return;
    case 'start':
      operations.write(await operations.createProfile().start());
      return;
    case 'stop':
      await operations.createProfile().stop();
      return;
    case 'kill':
      await operations.createProfile().kill();
      return;
    case 'status': {
      const status: ProductionProfileStatus = await operations
        .createProfile()
        .assertReady();
      operations.write(status);
      return;
    }
    default:
      throw new Error(
        'usage: mammoth-profile <bootstrap|start|stop|kill|status|verify-lifecycle|verify-backup>',
      );
  }
}
