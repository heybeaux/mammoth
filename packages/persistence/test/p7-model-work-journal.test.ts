import { appendFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  canonicalDigest,
  modelWorkIdentityDigest,
  providerAttemptIdentityDigest,
  providerEffectIdentityDigest,
  type ModelWorkIdentity,
  type ModelWorkRequest,
  type ProviderAttemptIdentity,
  type ProviderEffectIdentity,
} from '@mammoth/domain';
import {
  JournaledP7ModelWorkRepository,
  type P7ModelWorkRecord,
  type P7ProviderAttemptRecord,
} from '../src/index.js';

const now = '2026-07-14T07:00:00.000Z';
const later = '2026-07-14T07:01:00.000Z';
const digestA = canonicalDigest({ fixture: 'journal-a' });
const digestB = canonicalDigest({ fixture: 'journal-b' });
const digestC = canonicalDigest({ fixture: 'journal-c' });

function identity(): ModelWorkIdentity {
  const base: ModelWorkIdentity = {
    programId: 'program-journal',
    topologyId: 'topology-journal',
    topologyDigest: digestA,
    cellId: 'cell-journal',
    criterionId: 'criterion-journal',
    criterionVersion: 1,
    criterionDigest: digestB,
    workItemContractDigest: digestA,
    promptTemplateDigest: digestB,
    canonicalInputDigest: digestC,
    modelProfileVersionId: 'profile-journal',
    modelProfileVersionDigest: digestA,
    policyVersion: MODEL_WORK_POLICY_VERSION,
    policyDigest: digestB,
    toolContractDigest: digestC,
    outputSchemaDigest: digestA,
    identityDigest: digestA,
  };
  return { ...base, identityDigest: modelWorkIdentityDigest(base) };
}

function request(): ModelWorkRequest {
  const modelIdentity = identity();
  const attemptBase: ProviderAttemptIdentity = {
    modelWorkIdentityDigest: modelIdentity.identityDigest,
    attemptOrdinal: 1,
    provider: 'fixture-provider',
    concreteModel: 'fixture-model',
    checkpoint: 'fixture-checkpoint',
    attemptDigest: digestA,
  };
  const attempt = {
    ...attemptBase,
    attemptDigest: providerAttemptIdentityDigest(attemptBase),
  };
  const effectBase: ProviderEffectIdentity = {
    providerAttemptDigest: attempt.attemptDigest,
    modelWorkIdentityDigest: modelIdentity.identityDigest,
    operationKind: 'chat_completion',
    canonicalRequestDigest: canonicalDigest({ journal: 1 }),
    idempotencyKey: digestA,
  };
  const effect = {
    ...effectBase,
    idempotencyKey: providerEffectIdentityDigest(effectBase),
  };
  return {
    schemaVersion: MODEL_WORK_REQUEST_SCHEMA_VERSION,
    identity: modelIdentity,
    attempt,
    effect,
    capabilityManifestDigest: digestB,
    canonicalPromptDigest: digestB,
    budget: {
      inputTokens: 100,
      outputTokens: 50,
      currencyMicros: 1_000,
      wallClockMs: 30_000,
      toolCalls: 0,
    },
    outputSchemaVersion: MODEL_WORK_RESULT_SCHEMA_VERSION,
  };
}

function modelWork(): P7ModelWorkRecord {
  const authoritativeRequest = request();
  return {
    id: 'model-work-journal',
    stableIdentity: authoritativeRequest.identity.identityDigest,
    programId: authoritativeRequest.identity.programId,
    topologyId: authoritativeRequest.identity.topologyId,
    cellId: authoritativeRequest.identity.cellId,
    topologyAttemptId: 'topology-attempt-journal',
    reservationId: 'reservation-journal',
    request: authoritativeRequest,
    state: 'planned',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function attemptRecord(): P7ProviderAttemptRecord {
  const authoritativeRequest = request();
  return {
    id: 'provider-attempt-journal',
    stableIdentity: authoritativeRequest.attempt.attemptDigest,
    modelWorkId: 'model-work-journal',
    modelWorkIdentityDigest:
      authoritativeRequest.attempt.modelWorkIdentityDigest,
    attemptOrdinal: 1,
    provider: authoritativeRequest.attempt.provider,
    concreteModel: authoritativeRequest.attempt.concreteModel,
    checkpoint: authoritativeRequest.attempt.checkpoint,
    capabilityManifestDigest: authoritativeRequest.capabilityManifestDigest,
    request: authoritativeRequest,
    state: 'planned',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('P7 journaled model-work repository', () => {
  it('replays the journal across process-style reopen', async () => {
    const home = await mkdtemp(join(tmpdir(), 'p7-journal-'));
    const path = join(home, 'journal.jsonl');
    const first = await JournaledP7ModelWorkRepository.open(path);
    const work = await first.recordModelWork(modelWork());
    await first.recordProviderAttempt(attemptRecord());
    await first.transitionModelWork({
      id: work.id,
      expectedRevision: 0,
      state: 'in_flight',
      updatedAt: later,
    });
    await first.close();

    const second = await JournaledP7ModelWorkRepository.open(path);
    const state = await second.reconstructProgram(work.programId);
    expect(state.modelWorks).toHaveLength(1);
    expect(state.modelWorks[0]).toMatchObject({
      id: work.id,
      state: 'in_flight',
      revision: 1,
    });
    expect(state.providerAttempts).toHaveLength(1);
    expect(state.providerAttempts[0]?.state).toBe('planned');
    await second.close();
  });

  it('discards an unacknowledged torn final journal line', async () => {
    const home = await mkdtemp(join(tmpdir(), 'p7-journal-torn-'));
    const path = join(home, 'journal.jsonl');
    const first = await JournaledP7ModelWorkRepository.open(path);
    const work = await first.recordModelWork(modelWork());
    await first.close();
    await appendFile(path, '{"op":"transitionModelWork","input":{"id"');

    const reopened = await JournaledP7ModelWorkRepository.open(path);
    const state = await reopened.reconstructProgram(work.programId);
    expect(state.modelWorks[0]).toMatchObject({
      state: 'planned',
      revision: 0,
    });
    await reopened.close();
  });

  it('fails closed on a corrupt interior journal line', async () => {
    const home = await mkdtemp(join(tmpdir(), 'p7-journal-corrupt-'));
    const path = join(home, 'journal.jsonl');
    const first = await JournaledP7ModelWorkRepository.open(path);
    await first.recordModelWork(modelWork());
    await first.close();
    const contents = await readFile(path, 'utf8');
    await appendFile(path, 'garbage\n');
    await appendFile(path, contents.replace('model-work-journal', 'mw-two'));
    await expect(JournaledP7ModelWorkRepository.open(path)).rejects.toThrow();
  });
});
