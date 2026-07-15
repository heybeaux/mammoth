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
  readonly authorizedBudgetUsd: number | null;
}

const MAX_AUTHORIZED_BUDGET_USD = 5;

export function evaluateP9LiveAuthority(
  env: P9LiveAuthorityEnvironment,
): P9LiveAuthorityReport {
  const explicitAuthorization = env.MAMMOTH_P9_LIVE_RESEARCH === 'authorized';
  const searchCredential = nonEmpty(env.MAMMOTH_SEARCH_BRAVE_API_KEY);
  const billingAuthorization =
    env.MAMMOTH_P9_LIVE_BILLING_AUTHORIZATION === 'authorized';
  const providerBaseUrl = nonEmpty(env.MAMMOTH_P9_PROVIDER_BASE_URL);
  const proposerModel = nonEmpty(env.MAMMOTH_P9_PROPOSER_MODEL);
  const evaluatorModel = nonEmpty(env.MAMMOTH_P9_EVALUATOR_MODEL);
  const distinctProfileFamilies =
    proposerModel &&
    evaluatorModel &&
    modelProfileFamily(proposerModel) !== modelProfileFamily(evaluatorModel);
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
    Boolean(proposerModel) &&
    Boolean(evaluatorModel) &&
    proposerModel !== evaluatorModel &&
    Boolean(distinctProfileFamilies) &&
    Boolean(providerApiKeyEnv) &&
    Boolean(providerApiKey);

  return {
    status: ready ? 'ready' : 'blocked_live_exhibition',
    localProfile: 'ok',
    safeForEffects: ready,
    authorizedBudgetUsd: budget,
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
        ? `MAMMOTH_P9_LIVE_BUDGET_USD must be positive and no greater than ${MAX_AUTHORIZED_BUDGET_USD.toFixed(2)} USD`
        : `P9 live budget cap accepted: ${budget.toFixed(2)} USD`,
    liveModelProvider:
      providerBaseUrl && proposerModel && evaluatorModel
        ? 'OpenAI-compatible P9 proposer and evaluator configured'
        : 'MAMMOTH_P9_PROVIDER_BASE_URL, MAMMOTH_P9_PROPOSER_MODEL, and MAMMOTH_P9_EVALUATOR_MODEL required',
    liveModelCredential:
      providerApiKeyEnv && providerApiKey
        ? `P9 provider API credential present via ${providerApiKeyEnv}`
        : 'MAMMOTH_P9_PROVIDER_API_KEY_ENV must name a populated environment variable for live synthesis',
    liveEvaluatorIndependence:
      proposerModel &&
      evaluatorModel &&
      proposerModel !== evaluatorModel &&
      distinctProfileFamilies
        ? 'P9 proposer and evaluator use distinct model identities and profile families'
        : 'MAMMOTH_P9_PROPOSER_MODEL and MAMMOTH_P9_EVALUATOR_MODEL must be distinct model identities from distinct profile families',
  };
}

function nonEmpty(value: string | undefined): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : '';
}

function parsePositiveBudget(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= MAX_AUTHORIZED_BUDGET_USD
    ? parsed
    : null;
}

function modelProfileFamily(model: string): string {
  const [provider = 'unknown', name = model] = model.split('/', 2);
  const family = name.split(/[-:.]/u, 1)[0] ?? name;
  return `${provider}/${family}`;
}
