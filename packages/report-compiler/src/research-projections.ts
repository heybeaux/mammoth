import { canonicalDigest, canonicalJson } from '@mammoth/domain';
import { z } from 'zod';

export const RESEARCH_PROJECTION_CONTRACT_FAMILY =
  'research-projection.v1' as const;

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const IdentifierSchema = z.string().min(1);

const ProjectionLineageSchema = z
  .object({
    planId: IdentifierSchema,
    planDigest: DigestSchema,
    acceptanceReceiptId: IdentifierSchema,
    acceptanceReceiptDigest: DigestSchema,
    executionId: IdentifierSchema,
    executionReceiptId: IdentifierSchema,
    executionReceiptDigest: DigestSchema,
  })
  .strict();

const ProjectionCoverageSchema = z
  .object({
    assessmentId: IdentifierSchema,
    assessmentDigest: DigestSchema,
    verdict: z.enum(['covered', 'insufficient']),
    gaps: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((coverage, context) => {
    if ((coverage.verdict === 'covered') !== (coverage.gaps.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gaps'],
        message: 'covered projection input must have no coverage gaps',
      });
    }
  });

const ProjectionSourceSchema = z
  .object({
    sourceId: IdentifierSchema,
    title: z.string().min(1),
    url: z.string().url(),
    sourceClass: z.string().min(1),
    sourceFamilyId: IdentifierSchema,
    snapshotDigest: DigestSchema,
    retrievedAt: z.string().datetime(),
    attemptId: IdentifierSchema,
    attemptDigest: DigestSchema,
    parserReceiptId: IdentifierSchema,
    parserReceiptDigest: DigestSchema,
  })
  .strict();

const ProjectionEvidenceBindingSchema = z
  .object({
    sourceId: IdentifierSchema,
    snapshotDigest: DigestSchema,
    quoteDigest: DigestSchema,
    locator: z
      .object({
        coordinateSpace: z.string().min(1),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.locator.endOffset <= binding.locator.startOffset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locator', 'endOffset'],
        message: 'projection evidence locator must select a non-empty span',
      });
    }
  });

const ProjectionClaimSchema = z
  .object({
    claimId: IdentifierSchema,
    statement: z.string().min(1),
    proposalId: IdentifierSchema,
    proposalDigest: DigestSchema,
    verdictId: IdentifierSchema,
    verdictDigest: DigestSchema,
    verdict: z.enum(['entailed', 'contradicted', 'insufficient']),
    evaluatorProfileVersionId: IdentifierSchema,
    evaluatorProfileFamilyId: IdentifierSchema,
    verdictReasonCodes: z.array(z.string().min(1)),
    admissionId: IdentifierSchema,
    admissionDigest: DigestSchema,
    admissionPolicyId: IdentifierSchema,
    admissionDecision: z.enum(['admitted', 'rejected']),
    admissionReasonCodes: z.array(z.string().min(1)),
    evidence: z.array(ProjectionEvidenceBindingSchema).min(1),
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      (claim.admissionDecision === 'admitted') !==
      (claim.verdict === 'entailed')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['admissionDecision'],
        message: 'only independently entailed claims may be admitted',
      });
    }
  });

const ProjectionSentenceSchema = z
  .object({
    sentenceId: IdentifierSchema,
    kind: z.enum(['factual', 'interpretive']),
    text: z.string().min(1),
    claimIds: z.array(IdentifierSchema),
  })
  .strict()
  .superRefine((sentence, context) => {
    if (sentence.kind === 'factual' && sentence.claimIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimIds'],
        message: 'factual reader sentences require admitted claims',
      });
    }
    if (sentence.kind === 'interpretive' && sentence.claimIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimIds'],
        message: 'interpretive reader sentences cannot present claims as fact',
      });
    }
  });

const ProjectionSectionSchema = z
  .object({
    sectionId: IdentifierSchema,
    title: z.string().min(1),
    sentences: z.array(ProjectionSentenceSchema).min(1),
  })
  .strict();

const ProjectionRejectionResidueSchema = z
  .object({
    claimId: IdentifierSchema,
    stage: z.string().min(1),
    reasonCodes: z.array(z.string().min(1)).min(1),
  })
  .strict();

const ProjectionBoundRecordSchema = z
  .object({
    recordId: IdentifierSchema,
    recordDigest: DigestSchema,
    record: z.record(z.unknown()),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.recordDigest !== canonicalDigest(entry.record)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordDigest'],
        message: 'audit residue digest must bind the complete record',
      });
    }
  });

const ProjectionOperatorResidueSchema = z
  .object({
    budgetJournal: z
      .object({
        journalDigest: DigestSchema,
        entries: z.array(z.record(z.unknown())),
      })
      .strict()
      .superRefine((journal, context) => {
        if (journal.journalDigest !== canonicalDigest(journal.entries)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['journalDigest'],
            message: 'budget journal digest must bind every retained entry',
          });
        }
      }),
    parserReceipts: z.array(ProjectionBoundRecordSchema),
    verificationRecords: z.array(ProjectionBoundRecordSchema),
  })
  .strict();

export const ResearchProjectionInputSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(RESEARCH_PROJECTION_CONTRACT_FAMILY),
    question: z.string().min(1),
    compiledAt: z.string().datetime(),
    lineage: ProjectionLineageSchema,
    coverage: ProjectionCoverageSchema,
    operatorResidue: ProjectionOperatorResidueSchema,
    sources: z.array(ProjectionSourceSchema).min(1),
    claims: z.array(ProjectionClaimSchema).min(1),
    sections: z.array(ProjectionSectionSchema).min(1),
    rejectionResidue: z.array(ProjectionRejectionResidueSchema),
  })
  .strict()
  .superRefine((input, context) => {
    assertUnique(
      input.sources.map((source) => source.sourceId),
      'source',
      context,
    );
    assertUnique(
      input.claims.map((claim) => claim.claimId),
      'claim',
      context,
    );
    assertUnique(
      input.sections.map((section) => section.sectionId),
      'section',
      context,
    );
    assertUnique(
      input.sections.flatMap((section) =>
        section.sentences.map((sentence) => sentence.sentenceId),
      ),
      'sentence',
      context,
    );

    const sources = new Map(
      input.sources.map((source) => [source.sourceId, source]),
    );
    const claims = new Map(input.claims.map((claim) => [claim.claimId, claim]));
    const parserReceipts = new Map(
      input.operatorResidue.parserReceipts.map((receipt) => [
        receipt.recordId,
        receipt,
      ]),
    );
    assertUnique(
      input.operatorResidue.parserReceipts.map((receipt) => receipt.recordId),
      'parser receipt',
      context,
    );
    assertUnique(
      input.operatorResidue.verificationRecords.map(
        (record) => record.recordId,
      ),
      'verification record',
      context,
    );
    for (const source of input.sources) {
      const parserReceipt = parserReceipts.get(source.parserReceiptId);
      if (
        !parserReceipt ||
        parserReceipt.recordDigest !== source.parserReceiptDigest
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['operatorResidue', 'parserReceipts'],
          message: `source ${source.sourceId} lacks its complete parser receipt`,
        });
      }
    }
    for (const claim of input.claims) {
      for (const evidence of claim.evidence) {
        const source = sources.get(evidence.sourceId);
        if (!source) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['claims'],
            message: `claim ${claim.claimId} references unknown source ${evidence.sourceId}`,
          });
        } else if (source.snapshotDigest !== evidence.snapshotDigest) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['claims'],
            message: `claim ${claim.claimId} does not bind the source snapshot digest`,
          });
        }
      }
    }
    for (const section of input.sections) {
      for (const sentence of section.sentences) {
        assertUnique(sentence.claimIds, 'sentence claim', context);
        for (const claimId of sentence.claimIds) {
          const claim = claims.get(claimId);
          if (!claim) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['sections'],
              message: `reader sentence references unknown claim ${claimId}`,
            });
          } else if (claim.admissionDecision !== 'admitted') {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['sections'],
              message: `reader sentence references non-admitted claim ${claimId}`,
            });
          }
        }
      }
    }
    for (const residue of input.rejectionResidue) {
      const claim = claims.get(residue.claimId);
      if (!claim || claim.admissionDecision !== 'rejected') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rejectionResidue'],
          message: `rejection residue ${residue.claimId} must bind a rejected claim`,
        });
      }
    }
  });

const PublicCitationSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().min(1),
    url: z.string().url(),
    sourceClass: z.string().min(1),
  })
  .strict();

const CrossProjectionSentenceBindingSchema = z
  .object({
    sectionOrdinal: z.number().int().nonnegative(),
    sentenceOrdinal: z.number().int().nonnegative(),
    sentenceDigest: DigestSchema,
    claimIds: z.array(IdentifierSchema),
    citationNumbers: z.array(z.number().int().positive()),
  })
  .strict();

const ResearchProjectionReceiptSchema = z
  .object({
    inputDigest: DigestSchema,
    readerMarkdownDigest: DigestSchema,
    auditMarkdownDigest: DigestSchema,
    sentenceBindingsDigest: DigestSchema,
    projectionDigest: DigestSchema,
  })
  .strict();

export const ResearchProjectionBundleSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    contractFamily: z.literal(RESEARCH_PROJECTION_CONTRACT_FAMILY),
    reader: z
      .object({
        markdown: z.string().min(1),
        citations: z.array(PublicCitationSchema),
      })
      .strict(),
    audit: z
      .object({
        markdown: z.string().min(1),
        input: ResearchProjectionInputSchema,
        sentenceBindings: z.array(CrossProjectionSentenceBindingSchema),
      })
      .strict(),
    receipt: ResearchProjectionReceiptSchema,
  })
  .strict();

export type ResearchProjectionInput = z.infer<
  typeof ResearchProjectionInputSchema
>;
export type ResearchProjectionBundle = z.infer<
  typeof ResearchProjectionBundleSchema
>;

export class ResearchProjectionIntegrityError extends Error {
  readonly code = 'RESEARCH_PROJECTION_INTEGRITY_FAILURE';
}

export function compileResearchProjections(
  value: unknown,
): ResearchProjectionBundle {
  const input = ResearchProjectionInputSchema.parse(value);
  const sources = new Map(
    input.sources.map((source) => [source.sourceId, source]),
  );
  const claims = new Map(input.claims.map((claim) => [claim.claimId, claim]));
  const citationNumberBySource = new Map<string, number>();
  const publicCitations: z.infer<typeof PublicCitationSchema>[] = [];
  const sentenceBindings: z.infer<
    typeof CrossProjectionSentenceBindingSchema
  >[] = [];
  const readerLines = [`# ${input.question}`, ''];

  for (const [sectionOrdinal, section] of input.sections.entries()) {
    readerLines.push(`## ${section.title}`, '');
    for (const [sentenceOrdinal, sentence] of section.sentences.entries()) {
      const citationNumbers: number[] = [];
      if (sentence.kind === 'factual') {
        for (const claimId of sentence.claimIds) {
          const claim = claims.get(claimId);
          if (!claim) continue;
          for (const evidence of claim.evidence) {
            const source = sources.get(evidence.sourceId);
            if (!source) continue;
            let number = citationNumberBySource.get(source.sourceId);
            if (number === undefined) {
              number = citationNumberBySource.size + 1;
              citationNumberBySource.set(source.sourceId, number);
              publicCitations.push({
                number,
                title: source.title,
                url: source.url,
                sourceClass: source.sourceClass,
              });
            }
            if (!citationNumbers.includes(number)) citationNumbers.push(number);
          }
        }
      }
      citationNumbers.sort((left, right) => left - right);
      const suffix = citationNumbers
        .map((number) => `[${String(number)}]`)
        .join('');
      readerLines.push(`${sentence.text}${suffix}`, '');
      sentenceBindings.push({
        sectionOrdinal,
        sentenceOrdinal,
        sentenceDigest: canonicalDigest(sentence.text),
        claimIds: [...sentence.claimIds],
        citationNumbers,
      });
    }
  }
  readerLines.push('## Sources', '');
  for (const citation of publicCitations) {
    readerLines.push(
      `${String(citation.number)}. [${citation.title}](${citation.url}) — ${citation.sourceClass}.`,
    );
  }
  readerLines.push('');
  const reader = {
    markdown: readerLines.join('\n'),
    citations: publicCitations,
  };
  assertReaderProjectionIsPublic(reader.markdown, input);

  const auditLines = [
    `# Audit: ${input.question}`,
    '',
    'This projection retains the complete typed lineage and residue used to derive the reader report.',
    '',
    '## Complete Projection Input',
    '',
    '```json',
    canonicalJson(input),
    '```',
    '',
    '## Cross-Projection Sentence Bindings',
    '',
    '```json',
    canonicalJson(sentenceBindings),
    '```',
    '',
  ];
  const audit = {
    markdown: auditLines.join('\n'),
    input,
    sentenceBindings,
  };
  const receiptIdentity = {
    inputDigest: canonicalDigest(input),
    readerMarkdownDigest: canonicalDigest(reader.markdown),
    auditMarkdownDigest: canonicalDigest(audit.markdown),
    sentenceBindingsDigest: canonicalDigest(sentenceBindings),
  };
  const receipt = {
    ...receiptIdentity,
    projectionDigest: canonicalDigest(receiptIdentity),
  };
  return ResearchProjectionBundleSchema.parse({
    schemaVersion: '1.0.0',
    contractFamily: RESEARCH_PROJECTION_CONTRACT_FAMILY,
    reader,
    audit,
    receipt,
  });
}

export function verifyResearchProjectionBundle(
  value: unknown,
): ResearchProjectionBundle {
  const parsed = ResearchProjectionBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new ResearchProjectionIntegrityError(
      `projection bundle is structurally invalid: ${parsed.error.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }
  const expected = compileResearchProjections(parsed.data.audit.input);
  if (canonicalDigest(parsed.data) !== canonicalDigest(expected)) {
    throw new ResearchProjectionIntegrityError(
      'reader, audit, citation bridge, or projection receipt was altered',
    );
  }
  return parsed.data;
}

function assertReaderProjectionIsPublic(
  markdown: string,
  input: ResearchProjectionInput,
): void {
  const forbidden = [
    input.lineage.planId,
    input.lineage.acceptanceReceiptId,
    input.lineage.executionId,
    input.lineage.executionReceiptId,
    input.coverage.assessmentId,
    ...input.sources.flatMap((source) => [
      source.sourceId,
      source.attemptId,
      source.parserReceiptId,
    ]),
    ...input.operatorResidue.parserReceipts.map((receipt) => receipt.recordId),
    ...input.operatorResidue.verificationRecords.map(
      (record) => record.recordId,
    ),
    ...input.claims.flatMap((claim) => [
      claim.claimId,
      claim.proposalId,
      claim.verdictId,
      claim.admissionId,
    ]),
  ];
  if (/sha256:[a-f0-9]{64}/u.test(markdown)) {
    throw new ResearchProjectionIntegrityError(
      'reader projection exposes an internal digest',
    );
  }
  const leaked = forbidden.find((identity) => markdown.includes(identity));
  if (leaked) {
    throw new ResearchProjectionIntegrityError(
      'reader projection exposes an internal identity',
    );
  }
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
