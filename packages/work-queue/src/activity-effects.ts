import { createHash } from 'node:crypto';

export const activityTypes = [
  'retrieval',
  'snapshot',
  'parsing',
  'claim-proposal-admission',
  'assessment',
  'ledger-mutation',
  'report-compilation',
  'artifact-commit',
  'outbox-publication',
  'revalidation',
  'human-gate-handoff',
] as const;
export type ActivityTypeV1 = (typeof activityTypes)[number];

export const activityOperationKinds = [
  'retrieval.fetch',
  'artifact.cas-put.raw',
  'snapshot.metadata-commit',
  'parser.execute',
  'artifact.cas-put.parsed',
  'claim.proposal-admit',
  'claim.assess',
  'ledger.mutate',
  'report.compile',
  'artifact.cas-put.report',
  'artifact.metadata-commit',
  'outbox.publish',
  'revalidation.complete',
  'human-gate.open',
  'human-gate.notify',
] as const;
export type ActivityOperationKindV1 = (typeof activityOperationKinds)[number];
export type Digest = `sha256:${string}`;

export const activityOperationKindsByType = Object.freeze({
  retrieval: ['retrieval.fetch', 'artifact.cas-put.raw'],
  snapshot: ['snapshot.metadata-commit'],
  parsing: ['parser.execute', 'artifact.cas-put.parsed'],
  'claim-proposal-admission': ['claim.proposal-admit'],
  assessment: ['claim.assess'],
  'ledger-mutation': ['ledger.mutate'],
  'report-compilation': ['report.compile', 'artifact.cas-put.report'],
  'artifact-commit': ['artifact.metadata-commit'],
  'outbox-publication': ['outbox.publish'],
  revalidation: ['revalidation.complete'],
  'human-gate-handoff': ['human-gate.open', 'human-gate.notify'],
} as const satisfies Readonly<
  Record<ActivityTypeV1, readonly ActivityOperationKindV1[]>
>);

export interface EffectIdentityV1 {
  readonly schemaVersion: 1;
  readonly programId: string;
  readonly workItemId: string;
  readonly contractVersion: string;
  readonly inputDigest: Digest;
  readonly operationKind: ActivityOperationKindV1;
}

export interface ActivityAttributionV1 {
  readonly workflowId: string;
  readonly runId: string;
  readonly activityId: string;
  readonly attempt: number;
  readonly taskQueue: string;
  readonly workerId?: string;
}

export interface ActivityInvocationV1<TInput = unknown> {
  readonly schemaVersion: 1;
  readonly activityType: ActivityTypeV1;
  readonly operationKind: ActivityOperationKindV1;
  readonly contractVersion: string;
  readonly programId: string;
  readonly workItemId: string;
  readonly input: TInput;
  readonly inputDigest: Digest;
  readonly workflow: ActivityAttributionV1;
  readonly lease?: {
    readonly owner: string;
    readonly fencingToken: number;
  };
}

export interface ActivityPolicyV1 {
  readonly taskQueue:
    | 'retrieval'
    | 'local-small'
    | 'research-control'
    | 'human-gate';
  readonly scheduleToCloseMs: number;
  readonly startToCloseMs: number;
  readonly heartbeatTimeoutMs?: number;
  readonly maximumAttempts: number;
  readonly initialIntervalMs: number;
  readonly backoffCoefficient: 2;
  readonly maximumIntervalMs: number;
}

const minute = 60_000;
export const activityPolicies: Readonly<
  Record<ActivityTypeV1, ActivityPolicyV1>
> = Object.freeze({
  retrieval: policy(
    'retrieval',
    10 * minute,
    2 * minute,
    5,
    1_000,
    30_000,
    15_000,
  ),
  snapshot: policy('retrieval', 5 * minute, minute, 5, 1_000, 30_000),
  parsing: policy(
    'local-small',
    15 * minute,
    5 * minute,
    3,
    2_000,
    minute,
    30_000,
  ),
  'claim-proposal-admission': policy(
    'research-control',
    2 * minute,
    30_000,
    3,
    1_000,
    10_000,
  ),
  assessment: policy('research-control', 2 * minute, 30_000, 3, 1_000, 10_000),
  'ledger-mutation': policy(
    'research-control',
    2 * minute,
    30_000,
    5,
    1_000,
    10_000,
  ),
  'report-compilation': policy(
    'research-control',
    10 * minute,
    5 * minute,
    3,
    2_000,
    minute,
    30_000,
  ),
  'artifact-commit': policy(
    'research-control',
    5 * minute,
    minute,
    5,
    1_000,
    30_000,
  ),
  'outbox-publication': policy(
    'research-control',
    10 * minute,
    minute,
    10,
    1_000,
    minute,
    15_000,
  ),
  revalidation: policy(
    'retrieval',
    30 * minute,
    5 * minute,
    5,
    5_000,
    2 * minute,
    15_000,
  ),
  'human-gate-handoff': policy(
    'human-gate',
    5 * minute,
    30_000,
    5,
    1_000,
    30_000,
  ),
});

export const retryableActivityFailureCodes = [
  'dependency_unavailable',
  'network_timeout',
  'connection_reset',
  'provider_throttled',
  'provider_5xx',
  'database_deadlock',
  'database_serialization',
  'worker_interrupted',
  'provider_result_ambiguous',
] as const;
export const nonRetryableActivityFailureCodes = [
  'invalid_input',
  'unsupported_contract',
  'attribution_mismatch',
  'effect_identity_conflict',
  'security_denied',
  'egress_denied',
  'budget_denied',
  'digest_mismatch',
  'integrity_failure',
  'stale_fence',
  'stale_revision',
  'referential_integrity',
  'policy_denied',
  'unsupported_media',
  'deterministic_parser_rejection',
  'deterministic_compiler_rejection',
  'invalid_provider_result',
] as const;
export type ActivityFailureCode =
  | (typeof retryableActivityFailureCodes)[number]
  | (typeof nonRetryableActivityFailureCodes)[number];

export class ActivityFailure extends Error {
  constructor(
    readonly code: ActivityFailureCode,
    message: string,
    readonly retryable = (
      retryableActivityFailureCodes as readonly string[]
    ).includes(code),
  ) {
    super(message);
    this.name = 'ActivityFailure';
  }
}

export interface CompletedEffectV1<TResult = unknown> extends EffectIdentityV1 {
  readonly id: string;
  readonly provider: string;
  readonly idempotencyKey: Digest;
  readonly state: 'completed';
  readonly originalAttribution: ActivityAttributionV1 & {
    readonly leaseOwner?: string;
    readonly fencingToken?: number;
  };
  readonly providerReceipt: unknown;
  readonly resultSchema: string;
  readonly resultDigest: Digest;
  readonly result: TResult;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface PendingEffectV1 extends EffectIdentityV1 {
  readonly provider: string;
  readonly idempotencyKey: Digest;
  readonly state: 'started' | 'ambiguous';
}

export interface ActivityEffectStore {
  appendAttempt(input: ActivityAttemptInput): Promise<void>;
  lookup(
    provider: string,
    idempotencyKey: Digest,
  ): Promise<CompletedEffectV1 | PendingEffectV1 | undefined>;
  begin(input: BeginEffectInput): Promise<'started' | 'existing'>;
  markAmbiguous(
    provider: string,
    idempotencyKey: Digest,
    code: ActivityFailureCode,
  ): Promise<void>;
  complete(input: CompletedEffectV1): Promise<CompletedEffectV1>;
  heartbeat(
    input: ActivityAttemptInput,
    progress: HeartbeatProgressV1,
  ): Promise<void>;
  failAttempt(
    input: ActivityAttemptInput,
    failure: ActivityFailure,
  ): Promise<void>;
}

/**
 * Deterministic reference implementation used by the shared conformance suite.
 * Production implementations must provide the same immutable-result semantics
 * with durable transactions.
 */
export class InMemoryActivityEffectStore implements ActivityEffectStore {
  readonly #effects = new Map<string, CompletedEffectV1 | PendingEffectV1>();
  readonly #attempts: ActivityAttemptInput[] = [];
  readonly #heartbeats: HeartbeatProgressV1[] = [];
  readonly #failures: ActivityFailure[] = [];

  public async appendAttempt(input: ActivityAttemptInput): Promise<void> {
    await Promise.resolve();
    this.#attempts.push(structuredClone(input));
  }

  public async lookup(
    provider: string,
    idempotencyKey: Digest,
  ): Promise<CompletedEffectV1 | PendingEffectV1 | undefined> {
    await Promise.resolve();
    const effect = this.#effects.get(effectMapKey(provider, idempotencyKey));
    return effect === undefined ? undefined : structuredClone(effect);
  }

  public async begin(input: BeginEffectInput): Promise<'started' | 'existing'> {
    await Promise.resolve();
    const key = effectMapKey(input.provider, input.idempotencyKey);
    const existing = this.#effects.get(key);
    if (existing !== undefined) {
      assertEffectIdentity(existing, input.identity);
      return 'existing';
    }
    this.#effects.set(key, {
      ...structuredClone(input.identity),
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      state: 'started',
    });
    return 'started';
  }

  public async markAmbiguous(
    provider: string,
    idempotencyKey: Digest,
    code: ActivityFailureCode,
  ): Promise<void> {
    await Promise.resolve();
    void code;
    const key = effectMapKey(provider, idempotencyKey);
    const existing = this.#effects.get(key);
    if (existing === undefined || existing.state === 'completed') return;
    this.#effects.set(key, { ...existing, state: 'ambiguous' });
  }

  public async complete(input: CompletedEffectV1): Promise<CompletedEffectV1> {
    await Promise.resolve();
    const key = effectMapKey(input.provider, input.idempotencyKey);
    const existing = this.#effects.get(key);
    if (existing?.state === 'completed') {
      assertCompletedEqual(existing, input);
      return structuredClone(existing);
    }
    if (existing !== undefined) assertEffectIdentity(existing, input);
    this.#effects.set(key, structuredClone(input));
    return structuredClone(input);
  }

  public async heartbeat(
    _input: ActivityAttemptInput,
    progress: HeartbeatProgressV1,
  ): Promise<void> {
    await Promise.resolve();
    this.#heartbeats.push(validateHeartbeat(progress));
  }

  public async failAttempt(
    _input: ActivityAttemptInput,
    failure: ActivityFailure,
  ): Promise<void> {
    await Promise.resolve();
    this.#failures.push(failure);
  }

  public snapshot(): {
    readonly effects: readonly (CompletedEffectV1 | PendingEffectV1)[];
    readonly attempts: readonly ActivityAttemptInput[];
    readonly heartbeats: readonly HeartbeatProgressV1[];
    readonly failures: readonly ActivityFailure[];
  } {
    return {
      effects: structuredClone([...this.#effects.values()]),
      attempts: structuredClone(this.#attempts),
      heartbeats: structuredClone(this.#heartbeats),
      failures: [...this.#failures],
    };
  }
}

export interface ActivityAttemptInput {
  readonly invocation: ActivityInvocationV1;
  readonly idempotencyKey: Digest;
}
export interface BeginEffectInput extends ActivityAttemptInput {
  readonly provider: string;
  readonly identity: EffectIdentityV1;
  readonly startedAt: string;
}
export interface HeartbeatProgressV1 {
  readonly byteOffset?: number;
  readonly page?: number;
  readonly chunk?: number;
  readonly providerOperationId?: string;
  readonly partialCasDigest?: Digest;
}

export interface AttributableWorkItemV1 {
  readonly id: string;
  readonly programId: string;
  readonly activityType: ActivityTypeV1;
  readonly contractVersion: string;
  readonly inputDigest: Digest;
  readonly state: 'pending' | 'leased' | 'retry_wait' | 'completed';
}

export interface EffectProvider<TResult> {
  readonly name: string;
  reconcile?(
    idempotencyKey: Digest,
  ): Promise<
    { readonly receipt: unknown; readonly result: TResult } | undefined
  >;
  execute(
    idempotencyKey: Digest,
    context: ActivityEffectExecutionContext,
  ): Promise<{ readonly receipt: unknown; readonly result: TResult }>;
}

export interface ActivityEffectExecutionContext {
  readonly heartbeat: (progress: HeartbeatProgressV1) => Promise<void>;
}

export interface ExecuteActivityEffectOptions<TInput, TResult> {
  readonly invocation: ActivityInvocationV1<TInput>;
  readonly provider: EffectProvider<TResult>;
  readonly store: ActivityEffectStore;
  readonly resolveWork: (
    workItemId: string,
  ) => Promise<AttributableWorkItemV1 | undefined>;
  readonly resultSchema: string;
  readonly validateResult: (value: unknown) => TResult;
  readonly now: () => string;
  readonly id: () => string;
  readonly reportHeartbeat?: (progress: HeartbeatProgressV1) => void;
  readonly advanceWork?: (input: {
    readonly invocation: ActivityInvocationV1<TInput>;
    readonly provider: string;
    readonly idempotencyKey: Digest;
  }) => Promise<void>;
}

export async function executeActivityEffect<TInput, TResult>(
  options: ExecuteActivityEffectOptions<TInput, TResult>,
): Promise<TResult> {
  const { invocation } = options;
  validateInvocation(invocation);
  const identity: EffectIdentityV1 = {
    schemaVersion: 1,
    programId: invocation.programId,
    workItemId: invocation.workItemId,
    contractVersion: invocation.contractVersion,
    inputDigest: invocation.inputDigest,
    operationKind: invocation.operationKind,
  };
  const idempotencyKey = effectIdempotencyKey(identity);
  const attempt = { invocation, idempotencyKey };
  const work = await options.resolveWork(invocation.workItemId);
  await options.store.appendAttempt(attempt);
  try {
    const computedInputDigest = canonicalDigest(invocation.input);
    if (computedInputDigest !== invocation.inputDigest) {
      throw new ActivityFailure(
        'digest_mismatch',
        'Activity input digest does not match semantic input',
        false,
      );
    }
    validateAttribution(invocation, work);
  } catch (error) {
    const failure =
      error instanceof ActivityFailure
        ? error
        : new ActivityFailure(
            'invalid_input',
            error instanceof Error
              ? error.message
              : 'Activity input is invalid',
            false,
          );
    await options.store.failAttempt(attempt, failure);
    throw failure;
  }

  const existing = await options.store.lookup(
    options.provider.name,
    idempotencyKey,
  );
  if (existing?.state === 'completed') {
    const result = mapCompleted(existing, identity, options);
    if (work.state !== 'completed') await advanceWork(options, idempotencyKey);
    return result;
  }
  if (work.state === 'completed') {
    const failure = new ActivityFailure(
      'integrity_failure',
      'Completed work has no matching completed Activity effect',
      false,
    );
    await options.store.failAttempt(attempt, failure);
    throw failure;
  }
  if (existing) {
    if (!options.provider.reconcile) {
      const failure = new ActivityFailure(
        'provider_result_ambiguous',
        'Effect is already in progress and provider cannot reconcile by key',
      );
      await options.store.failAttempt(attempt, failure);
      throw failure;
    }
    try {
      const reconciled = await options.provider.reconcile(idempotencyKey);
      if (reconciled)
        return await persistAndMap(identity, attempt, reconciled, options);
    } catch (error) {
      throw await recordProviderFailure(options, attempt, error);
    }
  }

  const startedAt = options.now();
  const begin = await options.store.begin({
    ...attempt,
    provider: options.provider.name,
    identity,
    startedAt,
  });
  if (begin === 'existing') {
    const raced = await options.store.lookup(
      options.provider.name,
      idempotencyKey,
    );
    if (raced?.state === 'completed') {
      const result = mapCompleted(raced, identity, options);
      await advanceWork(options, idempotencyKey);
      return result;
    }
    if (options.provider.reconcile) {
      const reconciled = await options.provider.reconcile(idempotencyKey);
      if (reconciled) {
        return persistAndMap(identity, attempt, reconciled, options);
      }
    }
    const failure = new ActivityFailure(
      'provider_result_ambiguous',
      'A concurrent delivery already owns this provider effect',
    );
    await options.store.failAttempt(attempt, failure);
    throw failure;
  }
  try {
    const external = await options.provider.execute(idempotencyKey, {
      heartbeat: async (progress) => {
        const validated = validateHeartbeat(progress);
        await options.store.heartbeat(attempt, validated);
        options.reportHeartbeat?.(validated);
      },
    });
    return await persistAndMap(identity, attempt, external, options, startedAt);
  } catch (error) {
    throw await recordProviderFailure(options, attempt, error);
  }
}

async function recordProviderFailure<TInput, TResult>(
  options: ExecuteActivityEffectOptions<TInput, TResult>,
  attempt: ActivityAttemptInput,
  error: unknown,
): Promise<ActivityFailure> {
  const failure =
    error instanceof ActivityFailure
      ? error
      : new ActivityFailure(
          'provider_result_ambiguous',
          error instanceof Error
            ? error.message
            : 'Provider result is ambiguous',
        );
  if (
    failure.code === 'provider_result_ambiguous' ||
    failure.code === 'invalid_provider_result'
  ) {
    await options.store.markAmbiguous(
      options.provider.name,
      attempt.idempotencyKey,
      failure.code,
    );
  }
  await options.store.failAttempt(attempt, failure);
  return failure;
}

export function effectIdempotencyKey(identity: EffectIdentityV1): Digest {
  validateIdentity(identity);
  return canonicalDigest(identity);
}

export function canonicalDigest(value: unknown): Digest {
  const normalized = normalize(value);
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')}`;
}

export function validateHeartbeat(
  progress: HeartbeatProgressV1,
): HeartbeatProgressV1 {
  for (const value of [progress.byteOffset, progress.page, progress.chunk]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new ActivityFailure(
        'invalid_input',
        'Heartbeat counters must be non-negative safe integers',
        false,
      );
    }
  }
  if (
    progress.partialCasDigest !== undefined &&
    !isDigest(progress.partialCasDigest)
  ) {
    throw new ActivityFailure(
      'invalid_input',
      'Heartbeat CAS digest is invalid',
      false,
    );
  }
  return structuredClone(progress);
}

async function persistAndMap<TInput, TResult>(
  identity: EffectIdentityV1,
  attempt: ActivityAttemptInput,
  external: { readonly receipt: unknown; readonly result: TResult },
  options: ExecuteActivityEffectOptions<TInput, TResult>,
  startedAt = options.now(),
): Promise<TResult> {
  let result: TResult;
  try {
    result = options.validateResult(external.result);
  } catch {
    throw new ActivityFailure(
      'invalid_provider_result',
      'Provider result failed its registered schema',
      false,
    );
  }
  const completedAt = options.now();
  const completed: CompletedEffectV1<TResult> = {
    ...identity,
    id: options.id(),
    provider: options.provider.name,
    idempotencyKey: attempt.idempotencyKey,
    state: 'completed',
    originalAttribution: {
      ...attempt.invocation.workflow,
      ...(attempt.invocation.lease === undefined
        ? {}
        : {
            leaseOwner: attempt.invocation.lease.owner,
            fencingToken: attempt.invocation.lease.fencingToken,
          }),
    },
    providerReceipt: structuredClone(external.receipt),
    resultSchema: options.resultSchema,
    resultDigest: canonicalDigest(result),
    result: structuredClone(result),
    startedAt,
    completedAt,
  };
  const stored = await options.store.complete(completed);
  const mapped = mapCompleted(stored, identity, options);
  await advanceWork(options, attempt.idempotencyKey);
  return mapped;
}

async function advanceWork<TInput, TResult>(
  options: ExecuteActivityEffectOptions<TInput, TResult>,
  idempotencyKey: Digest,
): Promise<void> {
  await options.advanceWork?.({
    invocation: options.invocation,
    provider: options.provider.name,
    idempotencyKey,
  });
}

function mapCompleted<TInput, TResult>(
  record: CompletedEffectV1,
  identity: EffectIdentityV1,
  options: ExecuteActivityEffectOptions<TInput, TResult>,
): TResult {
  if (
    record.provider !== options.provider.name ||
    record.idempotencyKey !== effectIdempotencyKey(identity) ||
    record.programId !== identity.programId ||
    record.workItemId !== identity.workItemId ||
    record.contractVersion !== identity.contractVersion ||
    record.inputDigest !== identity.inputDigest ||
    record.operationKind !== identity.operationKind ||
    record.resultSchema !== options.resultSchema ||
    canonicalDigest(record.result) !== record.resultDigest
  ) {
    throw new ActivityFailure(
      'effect_identity_conflict',
      'Stored completed effect does not match invocation identity or result',
      false,
    );
  }
  try {
    return options.validateResult(structuredClone(record.result));
  } catch {
    throw new ActivityFailure(
      'effect_identity_conflict',
      'Stored completed effect result does not match registered schema',
      false,
    );
  }
}

function effectMapKey(provider: string, idempotencyKey: Digest): string {
  return `${provider}\u0000${idempotencyKey}`;
}

function assertEffectIdentity(
  record: EffectIdentityV1,
  identity: EffectIdentityV1,
): void {
  if (
    (record as { readonly schemaVersion: unknown }).schemaVersion !==
      (identity as { readonly schemaVersion: unknown }).schemaVersion ||
    record.programId !== identity.programId ||
    record.workItemId !== identity.workItemId ||
    record.contractVersion !== identity.contractVersion ||
    record.inputDigest !== identity.inputDigest ||
    record.operationKind !== identity.operationKind
  ) {
    throw new ActivityFailure(
      'effect_identity_conflict',
      'Provider key is already attributed to different semantic work',
      false,
    );
  }
}

function assertCompletedEqual(
  existing: CompletedEffectV1,
  candidate: CompletedEffectV1,
): void {
  assertEffectIdentity(existing, candidate);
  if (
    existing.resultSchema !== candidate.resultSchema ||
    existing.resultDigest !== candidate.resultDigest ||
    canonicalDigest(existing.result) !== existing.resultDigest ||
    canonicalDigest(candidate.result) !== candidate.resultDigest ||
    canonicalDigest(existing.providerReceipt) !==
      canonicalDigest(candidate.providerReceipt)
  ) {
    throw new ActivityFailure(
      'effect_identity_conflict',
      'Completed effect cannot be replaced by a different result or receipt',
      false,
    );
  }
}

function validateInvocation(invocation: ActivityInvocationV1): void {
  if (
    (invocation as { readonly schemaVersion: unknown }).schemaVersion !== 1 ||
    !activityTypes.includes(invocation.activityType) ||
    !activityOperationKinds.includes(invocation.operationKind) ||
    !nonEmpty(invocation.contractVersion) ||
    !nonEmpty(invocation.programId) ||
    !nonEmpty(invocation.workItemId) ||
    !isDigest(invocation.inputDigest) ||
    !nonEmpty(invocation.workflow.workflowId) ||
    !nonEmpty(invocation.workflow.runId) ||
    !nonEmpty(invocation.workflow.activityId) ||
    !Number.isSafeInteger(invocation.workflow.attempt) ||
    invocation.workflow.attempt < 1 ||
    !nonEmpty(invocation.workflow.taskQueue) ||
    (invocation.lease !== undefined &&
      (!nonEmpty(invocation.lease.owner) ||
        !Number.isSafeInteger(invocation.lease.fencingToken) ||
        invocation.lease.fencingToken < 1))
  ) {
    throw new ActivityFailure(
      'invalid_input',
      'Activity invocation envelope is invalid',
      false,
    );
  }
}

function validateIdentity(identity: EffectIdentityV1): void {
  if (
    (identity as { readonly schemaVersion: unknown }).schemaVersion !== 1 ||
    !nonEmpty(identity.programId) ||
    !nonEmpty(identity.workItemId) ||
    !nonEmpty(identity.contractVersion) ||
    !isDigest(identity.inputDigest) ||
    !activityOperationKinds.includes(identity.operationKind)
  ) {
    throw new ActivityFailure(
      'invalid_input',
      'Effect identity is invalid',
      false,
    );
  }
}

function validateAttribution(
  invocation: ActivityInvocationV1,
  work: AttributableWorkItemV1 | undefined,
): asserts work is AttributableWorkItemV1 {
  if (
    !(
      activityOperationKindsByType[
        invocation.activityType
      ] as readonly ActivityOperationKindV1[]
    ).includes(invocation.operationKind) ||
    !work ||
    work.id !== invocation.workItemId ||
    work.programId !== invocation.programId ||
    work.activityType !== invocation.activityType ||
    work.contractVersion !== invocation.contractVersion ||
    work.inputDigest !== invocation.inputDigest ||
    !['pending', 'leased', 'retry_wait', 'completed'].includes(work.state)
  ) {
    throw new ActivityFailure(
      'attribution_mismatch',
      'Activity invocation does not match attributable work',
      false,
    );
  }
}

function policy(
  taskQueue: ActivityPolicyV1['taskQueue'],
  scheduleToCloseMs: number,
  startToCloseMs: number,
  maximumAttempts: number,
  initialIntervalMs: number,
  maximumIntervalMs: number,
  heartbeatTimeoutMs?: number,
): ActivityPolicyV1 {
  return Object.freeze({
    taskQueue,
    scheduleToCloseMs,
    startToCloseMs,
    maximumAttempts,
    initialIntervalMs,
    backoffCoefficient: 2,
    maximumIntervalMs,
    ...(heartbeatTimeoutMs === undefined ? {} : { heartbeatTimeoutMs }),
  });
}

function normalize(value: unknown): unknown {
  if (value === undefined)
    throw new TypeError('Canonical JSON does not permit undefined values');
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new TypeError('Canonical JSON does not permit non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError('Canonical JSON permits only arrays and plain objects');
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, normalize(record[key])]),
  );
}
function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}
function isDigest(value: string): value is Digest {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}
