import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ProviderCapabilityManifestSchema,
  ProviderErrorCodeSchema,
  ProviderUsageSchema,
  canonicalDigest,
  providerCapabilityManifestDigest,
  type ProviderErrorCode,
} from '@mammoth/domain';

const expected = new Map<string, ProviderErrorCode>([
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

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const HostileManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    cases: z.array(
      z
        .object({
          id: z.string().min(1),
          expectedCode: ProviderErrorCodeSchema,
        })
        .strict(),
    ),
  })
  .strict();
const ExhibitionSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    kind: z.literal('single-local-provider-exhibition'),
    ok: z.literal(true),
    runAt: z.string().datetime(),
    baseRevision: z.string().regex(/^[0-9a-f]{40}$/u),
    runtime: z
      .object({
        node: z.string().min(1),
        platform: z.string().min(1),
        arch: z.string().min(1),
      })
      .strict(),
    endpoint: z
      .object({
        origin: z.string().url(),
        classification: z.literal('local-loopback'),
      })
      .strict(),
    manifest: ProviderCapabilityManifestSchema,
    identities: z
      .object({
        modelWork: DigestSchema,
        providerAttempt: DigestSchema,
        providerEffect: DigestSchema,
        capabilityManifest: DigestSchema,
        modelProfileVersion: z.string().min(1),
        modelProfileVersionDigest: DigestSchema,
        promptTemplate: DigestSchema,
        policy: DigestSchema,
        toolContract: DigestSchema,
        outputSchema: DigestSchema,
      })
      .strict(),
    requestDigest: DigestSchema,
    providerOperationId: z.string().min(1),
    usage: ProviderUsageSchema,
    finishReason: z.enum(['stop', 'length', 'content_filter']),
    responseDigest: DigestSchema,
    resultDigest: DigestSchema,
    returnedModel: z.string().min(1),
    returnedCheckpoint: z.string().min(1),
    temperature: z.number().min(0).max(2),
    seed: z.literal('unsupported'),
    timeoutMs: z.number().int().positive(),
    retries: z.number().int().nonnegative(),
    reconciliationMatched: z.boolean(),
    typedOutputAccepted: z.boolean(),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();

describe('P7 provider hostile fixture manifest', () => {
  it('maps every T2 attack fixture to a fail-closed code', async () => {
    const value = HostileManifestSchema.parse(
      JSON.parse(
        await readFile(
          resolve(
            process.cwd(),
            '../../evals/fixtures/p7/provider/hostile-cases.json',
          ),
          'utf8',
        ),
      ) as unknown,
    );
    expect(value).toEqual({
      schemaVersion: '1.0.0',
      cases: [...expected].map(([id, expectedCode]) => ({ id, expectedCode })),
    });
  });

  it('records a digest-consistent local Ollama exhibition without promoting model output', async () => {
    const value = ExhibitionSchema.parse(
      JSON.parse(
        await readFile(
          resolve(
            process.cwd(),
            '../../evals/fixtures/p7/provider/ollama-exhibition.json',
          ),
          'utf8',
        ),
      ) as unknown,
    );
    const manifest = value.manifest;
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
    const usage = value.usage;
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
    ] as const) {
      expect(value[key]).toMatch(
        key === 'baseRevision' ? /^[0-9a-f]{40}$/u : /^sha256:[0-9a-f]{64}$/u,
      );
    }
  });
});
