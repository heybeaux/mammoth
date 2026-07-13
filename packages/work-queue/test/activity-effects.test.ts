import { describe, expect, it } from 'vitest';
import {
  ActivityFailure,
  activityOperationKinds,
  activityPolicies,
  activityTypes,
  canonicalDigest,
  effectIdempotencyKey,
  executeActivityEffect,
  nonRetryableActivityFailureCodes,
  retryableActivityFailureCodes,
  validateHeartbeat,
  type ActivityAttemptInput,
  type ActivityEffectStore,
  type ActivityFailureCode,
  type ActivityInvocationV1,
  type AttributableWorkItemV1,
  type BeginEffectInput,
  type CompletedEffectV1,
  type Digest,
  type HeartbeatProgressV1,
  type PendingEffectV1,
} from '../src/index.js';

describe('P3 Activity catalog and policy', () => {
  it('freezes all eleven Activity types, operation kinds, routes, and retry ceilings', () => {
    expect(activityTypes).toHaveLength(11);
    expect(activityOperationKinds).toHaveLength(15);
    expect(Object.keys(activityPolicies).sort()).toEqual(
      [...activityTypes].sort(),
    );
    expect(activityPolicies.retrieval).toMatchObject({
      taskQueue: 'retrieval',
      heartbeatTimeoutMs: 15_000,
      maximumAttempts: 5,
    });
    expect(activityPolicies.parsing).toMatchObject({
      taskQueue: 'local-small',
      heartbeatTimeoutMs: 30_000,
      maximumAttempts: 3,
    });
    expect(activityPolicies['outbox-publication']).toMatchObject({
      taskQueue: 'research-control',
      heartbeatTimeoutMs: 15_000,
      maximumAttempts: 10,
    });
    expect(activityPolicies['human-gate-handoff']).toMatchObject({
      taskQueue: 'human-gate',
      maximumAttempts: 5,
    });
  });

  it('classifies retryable and non-retryable failures without message matching', () => {
    for (const code of retryableActivityFailureCodes)
      expect(new ActivityFailure(code, code).retryable).toBe(true);
    for (const code of nonRetryableActivityFailureCodes)
      expect(new ActivityFailure(code, code).retryable).toBe(false);
  });

  it('validates bounded heartbeat progress and rejects poison checkpoints', () => {
    expect(
      validateHeartbeat({
        chunk: 2,
        partialCasDigest: canonicalDigest('partial'),
      }),
    ).toEqual({
      chunk: 2,
      partialCasDigest: canonicalDigest('partial'),
    });
    expect(() => validateHeartbeat({ byteOffset: -1 })).toThrowError(
      ActivityFailure,
    );
    expect(() =>
      validateHeartbeat({ partialCasDigest: 'sha256:nope' as Digest }),
    ).toThrowError(ActivityFailure);
  });
});

describe('major-2 Activity effect execution', () => {
  it('derives one provider key across delivery attempts, workflow runs, and lease fences', () => {
    const first = invocation();
    const second = invocation({
      workflow: { ...first.workflow, runId: 'run-2', attempt: 9 },
      lease: { owner: 'worker-b', fencingToken: 12 },
    });
    const identity = (value: ActivityInvocationV1) => ({
      schemaVersion: 1 as const,
      programId: value.programId,
      workItemId: value.workItemId,
      contractVersion: value.contractVersion,
      inputDigest: value.inputDigest,
      operationKind: value.operationKind,
    });
    expect(effectIdempotencyKey(identity(first))).toBe(
      effectIdempotencyKey(identity(second)),
    );
  });

  it('maps forced duplicate delivery to the completed result without another provider effect', async () => {
    const store = new MemoryStore();
    const providerEffects = new Map<
      string,
      { receipt: unknown; result: Result }
    >();
    let calls = 0;
    const provider = {
      name: 'fixture-provider',
      execute: async (key: Digest) => {
        await Promise.resolve();
        calls += 1;
        const prior = providerEffects.get(key);
        if (prior) return prior;
        const result = {
          receipt: { providerId: 'external-1' },
          result: { artifactId: 'artifact-1' },
        };
        providerEffects.set(key, result);
        return result;
      },
      reconcile: (key: Digest) => Promise.resolve(providerEffects.get(key)),
    };
    const base = invocation();
    const first = await executeActivityEffect(options(base, store, provider));
    const duplicate = await executeActivityEffect(
      options(
        invocation({
          workflow: {
            ...base.workflow,
            runId: 'continued-run',
            activityId: 'activity-redelivery',
            attempt: 4,
          },
          lease: { owner: 'replacement-worker', fencingToken: 8 },
        }),
        store,
        provider,
      ),
    );
    expect(first).toEqual({ artifactId: 'artifact-1' });
    expect(duplicate).toEqual(first);
    expect(calls).toBe(1);
    expect(providerEffects).toHaveLength(1);
    expect(store.attempts).toHaveLength(2);
    expect(store.effects).toHaveLength(1);
  });

  it('fails poison attribution and input digest mismatch before any provider call', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const provider = {
      name: 'fixture-provider',
      execute: async () => {
        await Promise.resolve();
        calls += 1;
        return { receipt: {}, result: { artifactId: 'should-not-exist' } };
      },
    };
    await expect(
      executeActivityEffect(
        options(invocation({ programId: 'wrong-program' }), store, provider),
      ),
    ).rejects.toMatchObject({ code: 'attribution_mismatch', retryable: false });
    const badDigest = invocation({
      inputDigest: canonicalDigest({ different: true }),
    });
    await expect(
      executeActivityEffect(options(badDigest, store, provider)),
    ).rejects.toMatchObject({ code: 'digest_mismatch', retryable: false });
    expect(calls).toBe(0);
    expect(store.attempts).toHaveLength(0);
  });

  it('fails closed on completed-result tampering without calling the provider', async () => {
    const store = new MemoryStore();
    const input = invocation();
    const provider = {
      name: 'fixture-provider',
      execute: () =>
        Promise.resolve({
          receipt: {},
          result: { artifactId: 'artifact-1' },
        }),
    };
    await executeActivityEffect(options(input, store, provider));
    const completed = [
      ...store.effects.values(),
    ][0] as CompletedEffectV1<Result>;
    store.effects.set(keyOf(completed.provider, completed.idempotencyKey), {
      ...completed,
      result: { artifactId: 'tampered' },
    });
    let calls = 0;
    await expect(
      executeActivityEffect(
        options(
          invocation({ workflow: { ...input.workflow, attempt: 2 } }),
          store,
          {
            name: provider.name,
            execute: async () => {
              await Promise.resolve();
              calls += 1;
              return { receipt: {}, result: { artifactId: 'bad' } };
            },
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'effect_identity_conflict',
      retryable: false,
    });
    expect(calls).toBe(0);
  });

  it('records an ambiguous provider outcome and requires reconciliation on retry', async () => {
    const store = new MemoryStore();
    const input = invocation();
    await expect(
      executeActivityEffect(
        options(input, store, {
          name: 'fixture-provider',
          execute: async () => {
            await Promise.resolve();
            throw new Error('connection lost after commit');
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'provider_result_ambiguous',
      retryable: true,
    });
    expect([...store.effects.values()][0]).toMatchObject({
      state: 'ambiguous',
    });
    await expect(
      executeActivityEffect(
        options(
          invocation({ workflow: { ...input.workflow, attempt: 2 } }),
          store,
          {
            name: 'fixture-provider',
            execute: () =>
              Promise.resolve({
                receipt: {},
                result: { artifactId: 'must-not-run' },
              }),
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'provider_result_ambiguous' });
  });
});

interface Result {
  readonly artifactId: string;
}
function invocation(
  overrides: Partial<
    ActivityInvocationV1<{ target: string; providerVersion: string }>
  > = {},
): ActivityInvocationV1<{ target: string; providerVersion: string }> {
  const input = overrides.input ?? {
    target: 'https://example.test/source',
    providerVersion: 'v1',
  };
  return {
    schemaVersion: 1,
    activityType: 'retrieval',
    operationKind: 'retrieval.fetch',
    contractVersion: '2.0.0',
    programId: 'program-1',
    workItemId: 'work-1',
    input,
    inputDigest: canonicalDigest(input),
    workflow: {
      workflowId: 'program:program-1:branch:main',
      runId: 'run-1',
      activityId: 'activity-1',
      attempt: 1,
      taskQueue: 'retrieval',
    },
    lease: { owner: 'worker-a', fencingToken: 3 },
    ...overrides,
  };
}
function options(
  input: ActivityInvocationV1<{ target: string; providerVersion: string }>,
  store: MemoryStore,
  provider: {
    name: string;
    execute(key: Digest): Promise<{ receipt: unknown; result: Result }>;
    reconcile?(
      key: Digest,
    ): Promise<{ receipt: unknown; result: Result } | undefined>;
  },
) {
  return {
    invocation: input,
    provider,
    store,
    resolveWork: (): Promise<AttributableWorkItemV1> =>
      Promise.resolve({
        id: 'work-1',
        programId: 'program-1',
        activityType: 'retrieval',
        contractVersion: '2.0.0',
        inputDigest: canonicalDigest(input.input),
        state: 'leased',
      }),
    resultSchema: 'retrieval-result@1',
    validateResult: (value: unknown): Result => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof (value as { artifactId?: unknown }).artifactId !== 'string'
      )
        throw new Error('invalid');
      return value as Result;
    },
    now: () => '2026-07-13T12:00:00.000Z',
    id: () => 'effect-1',
  };
}

class MemoryStore implements ActivityEffectStore {
  readonly attempts: ActivityAttemptInput[] = [];
  readonly effects = new Map<string, CompletedEffectV1 | PendingEffectV1>();
  async appendAttempt(input: ActivityAttemptInput): Promise<void> {
    await Promise.resolve();
    this.attempts.push(structuredClone(input));
  }
  async lookup(provider: string, key: Digest) {
    await Promise.resolve();
    return structuredClone(this.effects.get(keyOf(provider, key)));
  }
  async begin(input: BeginEffectInput): Promise<'started' | 'existing'> {
    await Promise.resolve();
    const key = keyOf(input.provider, input.idempotencyKey);
    if (this.effects.has(key)) return 'existing';
    this.effects.set(key, {
      ...input.identity,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      state: 'started',
    });
    return 'started';
  }
  async markAmbiguous(
    provider: string,
    key: Digest,
    code: ActivityFailureCode,
  ): Promise<void> {
    await Promise.resolve();
    void code;
    const existing = this.effects.get(keyOf(provider, key));
    if (existing?.state === 'started')
      this.effects.set(keyOf(provider, key), {
        ...existing,
        state: 'ambiguous',
      });
  }
  async complete(input: CompletedEffectV1): Promise<CompletedEffectV1> {
    await Promise.resolve();
    const key = keyOf(input.provider, input.idempotencyKey);
    const existing = this.effects.get(key);
    if (existing?.state === 'completed') return structuredClone(existing);
    this.effects.set(key, structuredClone(input));
    return structuredClone(input);
  }
  async heartbeat(
    _input: ActivityAttemptInput,
    progress: HeartbeatProgressV1,
  ): Promise<void> {
    await Promise.resolve();
    validateHeartbeat(progress);
  }
  async failAttempt(
    input: ActivityAttemptInput,
    failure: ActivityFailure,
  ): Promise<void> {
    await Promise.resolve();
    void input;
    void failure;
  }
}
function keyOf(provider: string, key: Digest): string {
  return `${provider}\0${key}`;
}
