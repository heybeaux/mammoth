import { z } from 'zod';
import {
  DigestSchema,
  EntityIdSchema,
  EvidenceLocatorSchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from '@mammoth/domain';

export const P6SYNTHESIS_CONTRACT_VERSION = '1.0.0' as const;

export const P6SynthesisClaimAdmissionSchema = z
  .object({
    claimId: EntityIdSchema,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    policyId: EntityIdSchema,
    policyVersion: NonEmptyStringSchema,
    verdict: z.enum(['supported', 'contradicted', 'unresolved']),
    assessmentId: EntityIdSchema,
    evidence: z.array(
      z
        .object({
          evidenceId: EntityIdSchema,
          locator: EvidenceLocatorSchema,
          snapshotDigest: DigestSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const P6SynthesisSentenceSchema = z
  .object({
    sentenceId: EntityIdSchema,
    text: NonEmptyStringSchema,
    claimIds: z.array(EntityIdSchema).min(1),
    consensusDescriptorId: EntityIdSchema.optional(),
    experimentReceiptIds: z.array(EntityIdSchema).default([]),
  })
  .strict();

export const P6SynthesisConsensusDescriptorSchema = z
  .object({
    id: EntityIdSchema,
    claimIds: z.array(EntityIdSchema).min(1),
    label: z.enum(['agreement', 'disagreement', 'mixed', 'correlated']),
    nonAuthoritative: z.literal(true),
    correlatedModelProfileIds: z.array(EntityIdSchema).default([]),
  })
  .strict();

export const P6ExperimentReceiptSchema = z
  .object({
    id: EntityIdSchema,
    claimIds: z.array(EntityIdSchema).min(1),
    status: z.enum([
      'valid_reproduced',
      'failed_run',
      'cancelled_run',
      'invalid_environment_digest',
      'hidden_holdout_leakage',
    ]),
    environmentDigest: DigestSchema,
    outputDigest: DigestSchema.optional(),
  })
  .strict();

export const P6SynthesisManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractVersion: z.literal(P6SYNTHESIS_CONTRACT_VERSION),
    programId: EntityIdSchema,
    criterionId: EntityIdSchema,
    criterionVersion: z.number().int().positive(),
    criterionDigest: DigestSchema,
    generatedAt: TimestampSchema,
    admittedClaims: z.array(P6SynthesisClaimAdmissionSchema),
    factualSentences: z.array(P6SynthesisSentenceSchema),
    consensusDescriptors: z.array(P6SynthesisConsensusDescriptorSchema),
    experimentReceipts: z.array(P6ExperimentReceiptSchema).default([]),
    preservedDissentIds: z.array(EntityIdSchema),
    unresolvedIssueIds: z.array(EntityIdSchema),
  })
  .strict();

export type P6SynthesisManifest = z.infer<typeof P6SynthesisManifestSchema>;

export interface P6SynthesisIssue {
  readonly code:
    | 'INVALID_INPUT'
    | 'DUPLICATE_ID'
    | 'CRITERION_DRIFT'
    | 'UNADMITTED_CLAIM'
    | 'MISSING_EVIDENCE'
    | 'INVALID_POLICY_VERDICT'
    | 'AUTHORITATIVE_CONSENSUS'
    | 'UNSUPPORTED_AGREEMENT'
    | 'INVALID_EXPERIMENT_RECEIPT';
  readonly message: string;
  readonly sentenceId?: string;
  readonly claimId?: string;
}

export type P6SynthesisValidationResult =
  | { ok: true; manifest: P6SynthesisManifest }
  | { ok: false; issues: P6SynthesisIssue[] };

export function validateP6SynthesisManifest(
  input: unknown,
): P6SynthesisValidationResult {
  const parsed = P6SynthesisManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        {
          code: 'INVALID_INPUT',
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
      ],
    };
  }

  const manifest = parsed.data;
  const issues: P6SynthesisIssue[] = [];
  const admitted = new Map(
    manifest.admittedClaims.map((claim) => [claim.claimId, claim]),
  );
  const consensus = new Map(
    manifest.consensusDescriptors.map((descriptor) => [
      descriptor.id,
      descriptor,
    ]),
  );
  const receipts = new Map(
    manifest.experimentReceipts.map((receipt) => [receipt.id, receipt]),
  );

  pushDuplicateIssues(
    issues,
    manifest.admittedClaims.map(({ claimId }) => claimId),
    'admitted claim',
  );
  pushDuplicateIssues(
    issues,
    manifest.factualSentences.map(({ sentenceId }) => sentenceId),
    'sentence',
  );
  pushDuplicateIssues(
    issues,
    manifest.consensusDescriptors.map(({ id }) => id),
    'consensus descriptor',
  );
  pushDuplicateIssues(
    issues,
    manifest.experimentReceipts.map(({ id }) => id),
    'experiment receipt',
  );

  for (const claim of manifest.admittedClaims) {
    if (
      claim.criterionId !== manifest.criterionId ||
      claim.criterionVersion !== manifest.criterionVersion ||
      claim.criterionDigest !== manifest.criterionDigest
    ) {
      issues.push({
        code: 'CRITERION_DRIFT',
        message: `claim ${claim.claimId} criterion does not match synthesis criterion`,
        claimId: claim.claimId,
      });
    }
    if (claim.verdict !== 'supported') {
      issues.push({
        code: 'INVALID_POLICY_VERDICT',
        message: `claim ${claim.claimId} is not supported by a named policy verdict`,
        claimId: claim.claimId,
      });
    }
    if (claim.evidence.length === 0) {
      issues.push({
        code: 'MISSING_EVIDENCE',
        message: `claim ${claim.claimId} has no immutable evidence binding`,
        claimId: claim.claimId,
      });
    }
  }

  for (const sentence of manifest.factualSentences) {
    for (const claimId of sentence.claimIds) {
      if (!admitted.has(claimId)) {
        issues.push({
          code: 'UNADMITTED_CLAIM',
          message: `sentence ${sentence.sentenceId} references unadmitted claim ${claimId}`,
          sentenceId: sentence.sentenceId,
          claimId,
        });
      }
    }
    if (sentence.consensusDescriptorId !== undefined) {
      const descriptor = consensus.get(sentence.consensusDescriptorId);
      if (!descriptor) {
        issues.push({
          code: 'UNSUPPORTED_AGREEMENT',
          message: `sentence ${sentence.sentenceId} references missing consensus descriptor`,
          sentenceId: sentence.sentenceId,
        });
      }
    }
    for (const receiptId of sentence.experimentReceiptIds) {
      const receipt = receipts.get(receiptId);
      if (
        !receipt ||
        receipt.status !== 'valid_reproduced' ||
        !sentence.claimIds.every((claimId) =>
          receipt.claimIds.includes(claimId),
        )
      ) {
        issues.push({
          code: 'INVALID_EXPERIMENT_RECEIPT',
          message: `sentence ${sentence.sentenceId} references invalid experiment receipt ${receiptId}`,
          sentenceId: sentence.sentenceId,
        });
      }
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, manifest };
}

function pushDuplicateIssues(
  issues: P6SynthesisIssue[],
  ids: readonly string[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        message: `duplicate ${label} id ${id}`,
      });
    }
    seen.add(id);
  }
}
