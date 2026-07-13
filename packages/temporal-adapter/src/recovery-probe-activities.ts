import { Context } from '@temporalio/activity';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const legacyAttempts = new Map<string, number>();
const legacyEffects = new Set<string>();

export function resetRecoveryProbeActivities(): void {
  legacyAttempts.clear();
  legacyEffects.clear();
}

export function recoveryProbeActivitySnapshot(challengeId: string): {
  readonly attempts: number;
  readonly providerEffects: number;
} {
  return {
    attempts: legacyAttempts.get(challengeId) ?? 0,
    providerEffects: legacyEffects.has(challengeId) ? 1 : 0,
  };
}

export function recoveryProbeAmbiguousEffect(
  challengeId: string,
): Promise<string> {
  const attempts = (legacyAttempts.get(challengeId) ?? 0) + 1;
  legacyAttempts.set(challengeId, attempts);
  if (!legacyEffects.has(challengeId)) {
    legacyEffects.add(challengeId);
    return Promise.reject(new Error('injected failure after provider commit'));
  }
  return Promise.resolve(`receipt:recovery:${challengeId}`);
}

interface RecoveryReceipt {
  readonly schemaVersion: 1;
  readonly effectKey: string;
  readonly providerCallCount: 1;
}

export async function recoveryProbeEffect(input: {
  readonly effectKey: string;
  readonly receiptPath: string;
}): Promise<{
  readonly effectKey: string;
  readonly duplicatePrevented: boolean;
  readonly providerCallCount: number;
}> {
  Context.current().heartbeat({ checkpoint: 'before-effect' });
  await mkdir(dirname(input.receiptPath), { recursive: true });
  const receipt: RecoveryReceipt = {
    schemaVersion: 1,
    effectKey: input.effectKey,
    providerCallCount: 1,
  };
  let duplicatePrevented = false;
  try {
    await writeFile(input.receiptPath, `${JSON.stringify(receipt)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error: unknown) {
    if (!isAlreadyExists(error)) throw error;
    duplicatePrevented = true;
    const existing = JSON.parse(
      await readFile(input.receiptPath, 'utf8'),
    ) as unknown;
    if (!sameReceipt(existing, receipt)) {
      throw new Error('recovery receipt identity conflict');
    }
  }
  Context.current().heartbeat({ checkpoint: 'effect-receipt-durable' });

  if (
    !duplicatePrevented &&
    process.env.MAMMOTH_RECOVERY_CRASH_AFTER_EFFECT === '1'
  ) {
    process.kill(process.pid, 'SIGKILL');
    await new Promise<never>(() => undefined);
  }
  return {
    effectKey: input.effectKey,
    duplicatePrevented,
    providerCallCount: receipt.providerCallCount,
  };
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function sameReceipt(value: unknown, expected: RecoveryReceipt): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    value.schemaVersion === expected.schemaVersion &&
    'effectKey' in value &&
    value.effectKey === expected.effectKey &&
    'providerCallCount' in value &&
    value.providerCallCount === expected.providerCallCount
  );
}
