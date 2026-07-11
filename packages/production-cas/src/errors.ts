export type CasFailureCode =
  | 'INVALID_DIGEST'
  | 'CONTENT_MISSING'
  | 'INTEGRITY_FAILURE'
  | 'METADATA_CONFLICT';

export class ProductionCasError extends Error {
  constructor(
    readonly code: CasFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'ProductionCasError';
  }
}
