export const ADAPTER_ERROR_KINDS = [
  'transient',
  'rate-limited',
  'conflict',
  'permanent',
  'policy-denied',
  'integrity',
] as const;

export type AdapterErrorKind = (typeof ADAPTER_ERROR_KINDS)[number];

export interface AdapterFailure {
  readonly kind: AdapterErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly failClosed: boolean;
  readonly retryAfterMs?: number;
}

export function validateAdapterFailure(failure: AdapterFailure): void {
  const retryableKind =
    failure.kind === 'transient' ||
    failure.kind === 'rate-limited' ||
    failure.kind === 'conflict';
  if (failure.retryable !== retryableKind) {
    throw new Error(
      `adapter failure ${failure.kind} has invalid retryable=${String(failure.retryable)}`,
    );
  }
  if (!failure.failClosed) {
    throw new Error(`adapter failure ${failure.kind} must fail closed`);
  }
  if (
    failure.retryAfterMs !== undefined &&
    (!failure.retryable ||
      !Number.isSafeInteger(failure.retryAfterMs) ||
      failure.retryAfterMs < 0)
  ) {
    throw new Error('retryAfterMs requires a retryable non-negative delay');
  }
}
