import { z } from 'zod';
import {
  DigestSchema,
  MODEL_WORK_POLICY_VERSION,
  MODEL_WORK_REQUEST_SCHEMA_VERSION,
  MODEL_WORK_RESULT_SCHEMA_VERSION,
  PROVIDER_CAPABILITY_MANIFEST_VERSION,
  PROVIDER_ERROR_SCHEMA_VERSION,
  canonicalDigest,
  type Digest,
} from '@mammoth/domain';

export const P7_CONTRACT_MANIFEST_VERSION = '1.0.0' as const;

export const P7ContractManifestSchema = z
  .object({
    schemaVersion: z.literal(P7_CONTRACT_MANIFEST_VERSION),
    contracts: z
      .object({
        modelWorkRequest: z.literal(MODEL_WORK_REQUEST_SCHEMA_VERSION),
        modelWorkResult: z.literal(MODEL_WORK_RESULT_SCHEMA_VERSION),
        providerError: z.literal(PROVIDER_ERROR_SCHEMA_VERSION),
        modelWorkPolicy: z.literal(MODEL_WORK_POLICY_VERSION),
        capabilityManifest: z.literal(PROVIDER_CAPABILITY_MANIFEST_VERSION),
        applicationContractMajor: z.literal(1),
        workflowVersion: z.literal(1),
        projectionExtension: z.literal('1.0.0'),
      })
      .strict(),
    dependencyDirection: z
      .array(
        z
          .object({
            source: z.enum([
              '@mammoth/domain',
              '@mammoth/workflow',
              '@mammoth/provider-port',
              'p7-application-service',
            ]),
            mayDependOn: z.array(z.string()),
          })
          .strict(),
      )
      .length(4),
    authority: z
      .object({
        proposals: z.literal('provider'),
        validationAndAdmission: z.literal('deterministic-application-service'),
        productState: z.literal('postgres-cas'),
        orchestration: z.literal('temporal'),
        operatorProjection: z.literal('read-only'),
      })
      .strict(),
    manifestDigest: DigestSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.manifestDigest !== p7ContractManifestDigest(manifest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manifestDigest'],
        message: 'P7 contract manifest digest is not canonical',
      });
    }
  });

export type P7ContractManifest = z.infer<typeof P7ContractManifestSchema>;

export function p7ContractManifestDigest(manifest: P7ContractManifest): Digest {
  const record = { ...(manifest as Record<string, unknown>) };
  delete record.manifestDigest;
  return canonicalDigest({
    kind: 'p7-contract-manifest',
    schemaVersion: P7_CONTRACT_MANIFEST_VERSION,
    value: record,
  });
}
