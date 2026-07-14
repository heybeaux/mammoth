import assert from 'node:assert/strict';
import {
  ModelWorkRequestSchema,
  ProviderCapabilityManifestSchema,
  ProviderErrorSchema,
  type ModelWorkRequest,
} from '@mammoth/domain';
import type { ModelProviderPort } from './port.js';

export interface ProviderConformanceFixture {
  readonly provider: ModelProviderPort;
  readonly request: ModelWorkRequest;
  readonly canonicalRequestBytes: Uint8Array;
}

export async function verifyProviderPortConformance(
  fixture: ProviderConformanceFixture,
): Promise<void> {
  const manifest = ProviderCapabilityManifestSchema.parse(
    await fixture.provider.discoverCapabilities(),
  );
  const request = ModelWorkRequestSchema.parse(fixture.request);
  assert.equal(request.attempt.provider, manifest.provider);
  assert.equal(request.attempt.concreteModel, manifest.concreteModel);
  assert.equal(request.attempt.checkpoint, manifest.checkpoint);
  assert.equal(request.capabilityManifestDigest, manifest.manifestDigest);

  const dispatch = () =>
    fixture.provider.dispatch({
      modelWork: request,
      canonicalRequestBytes: fixture.canonicalRequestBytes,
      limits: request.budget,
    });
  const first = await dispatch();
  if (!first.ok) {
    ProviderErrorSchema.parse(first.error);
    assert.fail(`provider conformance dispatch failed: ${first.error.code}`);
  }
  assert.equal(first.envelope.provider, manifest.provider);
  assert.equal(first.envelope.concreteModel, manifest.concreteModel);
  assert.equal(first.envelope.checkpoint, manifest.checkpoint);
  assert.ok(first.envelope.rawResponseBytes.byteLength > 0);

  const duplicate = await dispatch();
  assert.deepEqual(
    duplicate,
    first,
    'duplicate dispatch must return one effect',
  );
  const reconciled = await fixture.provider.reconcile({
    idempotencyKey: request.effect.idempotencyKey,
    ...(first.envelope.providerOperationId
      ? { providerOperationId: first.envelope.providerOperationId }
      : {}),
  });
  assert.deepEqual(reconciled, first);
}
