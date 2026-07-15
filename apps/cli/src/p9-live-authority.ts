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
  readonly safeForEffects: boolean;
}

export function evaluateP9LiveAuthority(
  env: P9LiveAuthorityEnvironment,
): P9LiveAuthorityReport {
  const explicitAuthorization = env.MAMMOTH_P9_LIVE_RESEARCH === 'authorized';
  const searchCredential = nonEmpty(env.MAMMOTH_SEARCH_BRAVE_API_KEY);
  const billingAuthorization =
    env.MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION === 'authorized';
  const providerBaseUrl = nonEmpty(env.MAMMOTH_P9_PROVIDER_BASE_URL);
  const providerModel = nonEmpty(env.MAMMOTH_P9_PROVIDER_MODEL);
  const providerApiKeyEnv = nonEmpty(env.MAMMOTH_P9_PROVIDER_API_KEY_ENV);
  const providerApiKey = providerApiKeyEnv
    ? nonEmpty(env[providerApiKeyEnv])
    : '';
  const budget = parsePositiveBudget(env.MAMMOTH_P9_LIVE_BUDGET_USD);
  const ready =
    explicitAuthorization &&
    Boolean(searchCredential) &&
    billingAuthorization &&
    budget !== null &&
    Boolean(providerBaseUrl) &&
    Boolean(providerModel) &&
    Boolean(providerApiKeyEnv) &&
    Boolean(providerApiKey);

  return {
    status: ready ? 'ready' : 'blocked_live_exhibition',
    localProfile: 'ok',
    safeForEffects: ready,
    liveAuthorization: explicitAuthorization
      ? 'MAMMOTH_P9_LIVE_RESEARCH=authorized'
      : 'MAMMOTH_P9_LIVE_RESEARCH=authorized missing; P9 live exhibition remains blocked',
    liveSearch: searchCredential
      ? 'brave-search/v1 credential present'
      : 'MAMMOTH_SEARCH_BRAVE_API_KEY missing; P9 live exhibition cannot retrieve live sources',
    liveBilling: billingAuthorization
      ? 'P9 live billing explicitly authorized'
      : 'MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION=authorized missing; P9 live exhibition cannot spend provider budget',
    liveBudget:
      budget === null
        ? 'MAMMOTH_P9_LIVE_BUDGET_USD must be a positive finite number'
        : `P9 live budget cap accepted: ${budget.toFixed(2)} USD`,
    liveModelProvider:
      providerBaseUrl && providerModel
        ? 'OpenAI-compatible P9 synthesis provider configured'
        : 'MAMMOTH_P9_PROVIDER_BASE_URL and MAMMOTH_P9_PROVIDER_MODEL required for live synthesis',
    liveModelCredential:
      providerApiKeyEnv && providerApiKey
        ? `P9 provider API credential present via ${providerApiKeyEnv}`
        : 'MAMMOTH_P9_PROVIDER_API_KEY_ENV must name a populated environment variable for live synthesis',
  };
}

function nonEmpty(value: string | undefined): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : '';
}

function parsePositiveBudget(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
