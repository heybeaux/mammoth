import { describe, expect, it, vi } from 'vitest';
import {
  executeProfileCommand,
  type ProfileCommandOperations,
} from '../src/cli-command.js';

describe('production profile CLI command boundary', () => {
  it.each([
    ['verify-lifecycle', 'verifyLifecycle'],
    ['verify-backup', 'verifyBackup'],
  ] as const)(
    'runs the P2 %s verifier without constructing the Temporal profile',
    async (command, verifierName) => {
      const operations = fixture();
      const evidence = { command, ready: true };
      operations[verifierName].mockResolvedValue(evidence);

      await executeProfileCommand(command, operations);

      expect(operations.createProfile).not.toHaveBeenCalled();
      expect(operations[verifierName]).toHaveBeenCalledOnce();
      expect(operations.write).toHaveBeenCalledWith(evidence);
    },
  );

  it.each([
    ['bootstrap', 'bootstrap'],
    ['start', 'start'],
    ['stop', 'stop'],
    ['kill', 'kill'],
    ['status', 'assertReady'],
  ] as const)(
    'routes the combined P3 %s command through the Temporal-aware profile',
    async (command, methodName) => {
      const operations = fixture();
      const temporalFailure = new Error('spawn temporal ENOENT');
      operations.profile[methodName].mockRejectedValue(temporalFailure);

      await expect(executeProfileCommand(command, operations)).rejects.toBe(
        temporalFailure,
      );

      expect(operations.createProfile).toHaveBeenCalledOnce();
      expect(operations.profile[methodName]).toHaveBeenCalledOnce();
    },
  );
});

function fixture() {
  const profile = {
    bootstrap: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    start: vi.fn(() => Promise.resolve(readyStatus())),
    stop: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    kill: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    assertReady: vi.fn(() => Promise.resolve(readyStatus())),
  };
  return {
    profile,
    createProfile: vi.fn(() => profile),
    verifyLifecycle: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
    verifyBackup: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
    write: vi.fn<(value: unknown) => void>(),
  } satisfies ProfileCommandOperations & { readonly profile: typeof profile };
}

function readyStatus() {
  return {
    ready: true,
    postgres: { ready: true },
    temporal: { ready: true, failures: [] },
  } as const;
}
