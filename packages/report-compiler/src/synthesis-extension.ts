import { z } from 'zod';

export const SYNTHESIS_EXTENSION_CONTRACT_FAMILY =
  'research-synthesis-extension.v1' as const;

const IdentifierSchema = z.string().min(1);
const StatementSchema = z.string().min(1);

const PriorArtChallengeSchema = z
  .object({
    searchedAt: z.string().datetime(),
    scope: StatementSchema,
    finding: StatementSchema,
  })
  .strict();

export const MechanismTransferSchema = z
  .object({
    mechanismId: IdentifierSchema,
    sourceDomain: StatementSchema,
    targetDomain: StatementSchema,
    sharedMechanism: StatementSchema,
    nonEquivalences: z.array(StatementSchema).min(1),
    boundaryConditions: z.array(StatementSchema).min(1),
    predictions: z.array(StatementSchema).min(1),
    falsifiers: z.array(StatementSchema).min(1),
    priorArtChallenge: PriorArtChallengeSchema,
    supportingClaimIds: z.array(IdentifierSchema).min(1),
  })
  .strict();

export const ResearchHypothesisSchema = z
  .object({
    hypothesisId: IdentifierSchema,
    label: z.enum([
      'hypothesis',
      'cross_domain_hypothesis',
      'apparently_novel_hypothesis',
    ]),
    statement: StatementSchema,
    derivedFromClaimIds: z.array(IdentifierSchema).min(1),
    mechanismIds: z.array(IdentifierSchema).default([]),
    falsifiers: z.array(StatementSchema).min(1),
    priorArtChallenge: PriorArtChallengeSchema.optional(),
  })
  .strict()
  .superRefine((hypothesis, context) => {
    if (
      hypothesis.label === 'cross_domain_hypothesis' &&
      hypothesis.mechanismIds.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mechanismIds'],
        message:
          'cross-domain hypotheses must reference at least one mechanism transfer',
      });
    }
    if (
      hypothesis.label === 'apparently_novel_hypothesis' &&
      hypothesis.priorArtChallenge === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorArtChallenge'],
        message:
          'apparently novel hypotheses require a bounded, dated prior-art search',
      });
    }
  });

export const ExperimentProposalSchema = z
  .object({
    proposalId: IdentifierSchema,
    hypothesisIds: z.array(IdentifierSchema).min(1),
    uncertainty: StatementSchema,
    intervention: StatementSchema,
    evaluator: StatementSchema,
    threshold: StatementSchema,
    budget: StatementSchema,
    safetyBoundary: StatementSchema,
    falsifier: StatementSchema,
  })
  .strict();

export const SynthesisExtensionSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(SYNTHESIS_EXTENSION_CONTRACT_FAMILY),
    mechanisms: z.array(MechanismTransferSchema),
    hypotheses: z.array(ResearchHypothesisSchema),
    experimentProposals: z.array(ExperimentProposalSchema),
  })
  .strict()
  .superRefine((extension, context) => {
    assertUnique(
      extension.mechanisms.map(({ mechanismId }) => mechanismId),
      'mechanism',
      context,
    );
    assertUnique(
      extension.hypotheses.map(({ hypothesisId }) => hypothesisId),
      'hypothesis',
      context,
    );
    assertUnique(
      extension.experimentProposals.map(({ proposalId }) => proposalId),
      'experiment proposal',
      context,
    );
    const mechanismIds = new Set(
      extension.mechanisms.map(({ mechanismId }) => mechanismId),
    );
    const hypothesisIds = new Set(
      extension.hypotheses.map(({ hypothesisId }) => hypothesisId),
    );
    for (const hypothesis of extension.hypotheses) {
      for (const mechanismId of hypothesis.mechanismIds) {
        if (!mechanismIds.has(mechanismId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['hypotheses'],
            message: `hypothesis ${hypothesis.hypothesisId} references unknown mechanism ${mechanismId}`,
          });
        }
      }
    }
    for (const proposal of extension.experimentProposals) {
      for (const hypothesisId of proposal.hypothesisIds) {
        if (!hypothesisIds.has(hypothesisId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['experimentProposals'],
            message: `experiment proposal ${proposal.proposalId} references unknown hypothesis ${hypothesisId}`,
          });
        }
      }
    }
  });

export type MechanismTransfer = z.infer<typeof MechanismTransferSchema>;
export type ResearchHypothesis = z.infer<typeof ResearchHypothesisSchema>;
export type ExperimentProposal = z.infer<typeof ExperimentProposalSchema>;
export type SynthesisExtension = z.infer<typeof SynthesisExtensionSchema>;

export class SynthesisExtensionIntegrityError extends Error {
  readonly code = 'SYNTHESIS_EXTENSION_INTEGRITY_FAILURE';
}

export function validateSynthesisExtension(
  value: unknown,
  admittedClaimIds: ReadonlySet<string>,
): SynthesisExtension {
  const parsed = SynthesisExtensionSchema.safeParse(value);
  if (!parsed.success) {
    throw new SynthesisExtensionIntegrityError(
      `synthesis extension is structurally invalid: ${parsed.error.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }
  const extension = parsed.data;
  for (const mechanism of extension.mechanisms) {
    for (const claimId of mechanism.supportingClaimIds) {
      if (!admittedClaimIds.has(claimId)) {
        throw new SynthesisExtensionIntegrityError(
          `mechanism ${mechanism.mechanismId} is not derived from admitted evidence`,
        );
      }
    }
  }
  for (const hypothesis of extension.hypotheses) {
    for (const claimId of hypothesis.derivedFromClaimIds) {
      if (!admittedClaimIds.has(claimId)) {
        throw new SynthesisExtensionIntegrityError(
          `hypothesis ${hypothesis.hypothesisId} is not derived from admitted evidence`,
        );
      }
    }
  }
  return extension;
}

export function synthesisInternalIdentities(
  extension: SynthesisExtension,
): readonly string[] {
  return [
    ...extension.mechanisms.flatMap((mechanism) => [
      mechanism.mechanismId,
      ...mechanism.supportingClaimIds,
    ]),
    ...extension.hypotheses.flatMap((hypothesis) => [
      hypothesis.hypothesisId,
      ...hypothesis.derivedFromClaimIds,
      ...hypothesis.mechanismIds,
    ]),
    ...extension.experimentProposals.flatMap((proposal) => [
      proposal.proposalId,
      ...proposal.hypothesisIds,
    ]),
  ];
}

const HYPOTHESIS_LABELS: Record<ResearchHypothesis['label'], string> = {
  hypothesis: 'Hypothesis',
  cross_domain_hypothesis: 'Cross-domain hypothesis',
  apparently_novel_hypothesis: 'Apparently novel hypothesis',
};

export interface RenderSynthesisOptions {
  readonly citationNumbersForClaim?: (
    claimId: string,
  ) => readonly number[] | undefined;
}

export function renderSynthesisReaderLines(
  extension: SynthesisExtension,
  options: RenderSynthesisOptions = {},
): readonly string[] {
  const lines: string[] = [];
  const cite = (claimIds: readonly string[]): string => {
    const resolver = options.citationNumbersForClaim;
    if (!resolver) return '';
    const numbers = [
      ...new Set(claimIds.flatMap((claimId) => resolver(claimId) ?? [])),
    ].sort((left, right) => left - right);
    return numbers.map((number) => `[${String(number)}]`).join('');
  };
  const joined = (values: readonly string[]): string => values.join('; ');

  if (extension.mechanisms.length > 0) {
    lines.push('## Cross-domain mechanisms', '');
    for (const mechanism of extension.mechanisms) {
      lines.push(
        `- **${mechanism.sharedMechanism}** — ${mechanism.sourceDomain} → ${mechanism.targetDomain}.${cite(mechanism.supportingClaimIds)}`,
        `  - Does not transfer when: ${joined(mechanism.nonEquivalences)}.`,
        `  - Boundary conditions: ${joined(mechanism.boundaryConditions)}.`,
        `  - Predictions: ${joined(mechanism.predictions)}.`,
        `  - Falsifiers: ${joined(mechanism.falsifiers)}.`,
        `  - Prior-art challenge (${mechanism.priorArtChallenge.searchedAt}, ${mechanism.priorArtChallenge.scope}): ${mechanism.priorArtChallenge.finding}.`,
      );
    }
    lines.push('');
  }
  if (extension.hypotheses.length > 0) {
    lines.push('## Hypotheses', '');
    for (const hypothesis of extension.hypotheses) {
      lines.push(
        `- *${HYPOTHESIS_LABELS[hypothesis.label]}:* ${hypothesis.statement}${cite(hypothesis.derivedFromClaimIds)}`,
        `  - Falsifiers: ${joined(hypothesis.falsifiers)}.`,
      );
      if (hypothesis.priorArtChallenge) {
        lines.push(
          `  - Prior-art challenge (${hypothesis.priorArtChallenge.searchedAt}, ${hypothesis.priorArtChallenge.scope}): ${hypothesis.priorArtChallenge.finding}.`,
        );
      }
    }
    lines.push('');
  }
  if (extension.experimentProposals.length > 0) {
    lines.push('## Proposed experiments', '');
    for (const proposal of extension.experimentProposals) {
      lines.push(
        `- ${proposal.intervention}`,
        `  - Resolves uncertainty: ${proposal.uncertainty}.`,
        `  - Evaluator: ${proposal.evaluator}. Threshold: ${proposal.threshold}.`,
        `  - Budget: ${proposal.budget}. Safety boundary: ${proposal.safetyBoundary}.`,
        `  - Falsifier: ${proposal.falsifier}.`,
      );
    }
    lines.push('');
  }

  const markdown = lines.join('\n');
  if (/sha256:[a-f0-9]{64}/u.test(markdown)) {
    throw new SynthesisExtensionIntegrityError(
      'synthesis reader lines expose an internal digest',
    );
  }
  const leaked = synthesisInternalIdentities(extension).find((identity) =>
    markdown.includes(identity),
  );
  if (leaked) {
    throw new SynthesisExtensionIntegrityError(
      'synthesis reader lines expose an internal identity',
    );
  }
  return lines;
}

function assertUnique(
  values: readonly string[],
  label: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} identities must be unique`,
    });
  }
}
