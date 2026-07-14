import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ProviderCapabilityManifestSchema,
  canonicalDigest,
  providerCapabilityManifestDigest,
} from '@mammoth/domain';

const expected = new Map([
  ['local-non-loopback', 'policy_denied'],
  ['governed-private-address', 'policy_denied'],
  ['governed-mixed-dns', 'policy_denied'],
  ['unapproved-redirect-origin', 'policy_denied'],
  ['checkpoint-drift', 'profile_drift'],
  ['secret-in-prompt', 'secret_detected'],
  ['rate-limited', 'rate_limited'],
  ['provider-outage', 'provider_unavailable'],
  ['ambiguous-after-acceptance', 'ambiguous_delivery'],
  ['oversized-response', 'oversized_output'],
  ['unsupported-seed', 'unsupported_capability'],
  ['cancel-during-discovery', 'late_response'],
  ['inconsistent-usage', 'schema_incompatible'],
  ['reservation-exhausted', 'budget_exhausted'],
]);

describe('P7 provider hostile fixture manifest', () => {
  it('maps every T2 attack fixture to a fail-closed code', async () => {
    const value = JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          '../../evals/fixtures/p7/provider/hostile-cases.json',
        ),
        'utf8',
      ),
    ) as unknown;
    expect(value).toEqual({
      schemaVersion: '1.0.0',
      cases: [...expected].map(([id, expectedCode]) => ({ id, expectedCode })),
    });
  });

  it('records a digest-consistent local Ollama exhibition without promoting model output', async () => {
    const value = JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          '../../evals/fixtures/p7/provider/ollama-exhibition.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const manifest = ProviderCapabilityManifestSchema.parse(value.manifest);
    expect(manifest.manifestDigest).toBe(
      providerCapabilityManifestDigest(manifest),
    );
    expect(value).toMatchObject({
      kind: 'single-local-provider-exhibition',
      ok: true,
      endpoint: { classification: 'local-loopback' },
      returnedModel: manifest.concreteModel,
      returnedCheckpoint: manifest.checkpoint,
      reconciliationMatched: true,
      typedOutputAccepted: false,
    });
    const usage = value.usage as {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      currencyMicros: number;
    };
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
    expect(usage.currencyMicros).toBe(0);
    expect(value.resultDigest).toBe(
      canonicalDigest({
        providerOperationId: value.providerOperationId,
        finishReason: value.finishReason,
        usage: value.usage,
        responseDigest: value.responseDigest,
      }),
    );
    for (const key of [
      'baseRevision',
      'requestDigest',
      'responseDigest',
      'resultDigest',
    ]) {
      expect(String(value[key])).toMatch(
        key === 'baseRevision' ? /^[0-9a-f]{40}$/u : /^sha256:[0-9a-f]{64}$/u,
      );
    }
  });
});
