export type P9LiveAuthorityEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type P9LiveAuthorityStatus = 'ready' | 'blocked_live_exhibition';

export interface P9LiveAuthorityReport {
  readonly status: P9LiveAuthorityStatus;
  readonly localProfile: 'ok';
  readonly liveAuthorization: string;
  readonly liveSearch: string;
  readonly liveBilling: string;
  readonly liveBudget: string;
  readonly liveModelProvider: string;
  readonly liveModelCredential: string;
  readonly liveEvaluatorIndependence: string;
  readonly safeForEffects: boolean;
}

export function evaluateP9LiveAuthority(
  env: P9LiveAuthorityEnvironment,
): P9LiveAuthorityReport {
  void env;
  return {
    status: 'blocked_live_exhibition',
    localProfile: 'ok',
    safeForEffects: false,
    liveAuthorization:
      'environment flags cannot authorize P9 live effects; a pinned, scoped authority receipt is required',
    liveSearch: 'credential presence is not source-acquisition authorization',
    liveBilling:
      'environment flags cannot authorize billing; the scoped receipt must bind billing accounts',
    liveBudget:
      'environment budget values are ignored; the accepted plan and scoped receipt must bind the full budget vector',
    liveModelProvider:
      'environment model settings are ignored; immutable provider profiles must bind model identity and configuration',
    liveModelCredential: 'credential presence is not effect authorization',
    liveEvaluatorIndependence:
      'independent immutable proposer and evaluator profiles are required',
  };
}
