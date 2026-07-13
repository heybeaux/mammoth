import type { ProductionProfile, ProductionProfileStatus } from './profile.js';

export type ProductionProfileCommand =
  | 'bootstrap'
  | 'start'
  | 'stop'
  | 'kill'
  | 'status'
  | 'verify-p5'
  | 'verify-p4'
  | 'verify-lifecycle'
  | 'verify-backup';

export interface ProfileCommandOperations {
  readonly createProfile: () => Pick<
    ProductionProfile,
    'bootstrap' | 'start' | 'stop' | 'kill' | 'assertReady'
  >;
  readonly verifyLifecycle: () => Promise<unknown>;
  readonly verifyP4: () => Promise<unknown>;
  readonly verifyP5: () => Promise<unknown>;
  readonly verifyBackup: () => Promise<unknown>;
  readonly write: (value: unknown) => void;
}

/**
 * Keeps P2 Postgres/CAS and P4 research-cell verifiers independent from the P3
 * Temporal-aware profile. The factory stays lazy so verifier commands do not
 * load Temporal configuration or construct its service.
 */
export async function executeProfileCommand(
  command: string | undefined,
  operations: ProfileCommandOperations,
): Promise<void> {
  switch (command as ProductionProfileCommand | undefined) {
    case 'verify-p4':
      operations.write(await operations.verifyP4());
      return;
    case 'verify-p5':
      operations.write(await operations.verifyP5());
      return;
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
        'usage: mammoth-profile <bootstrap|start|stop|kill|status|verify-p4|verify-p5|verify-lifecycle|verify-backup>',
      );
  }
}
