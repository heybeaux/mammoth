import {
  canonicalDigest,
  DateExtractionVerdictSchema,
  RetrievalAttemptSchema,
  RetrievalCoverageResidueSchema,
  RetrievalTerminalStatusSchema,
  RobotsDecisionSchema,
  SourceDateObservationSchema,
  SourceRightsStatusSchema,
  type DateExtractionVerdict,
  type RetrievalAttempt,
  type RetrievalCoverageResidue,
  type RetrievalFailure,
  type RetrievalTerminalStatus,
  type RobotsDecision,
  type SourceDateObservation,
  type SourceRightsStatus,
} from '@mammoth/domain';

export interface SelectedRetrievalCandidate {
  readonly candidateId: string;
  readonly sourceClass: string;
  readonly requestedUrl: string;
  readonly selectedAt: string;
}

export class P9RetrievalResidueError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'P9RetrievalResidueError';
  }
}

export function makeNotCheckedRobotsDecision(input: {
  readonly requestedUrl: string;
  readonly finalUrl?: string;
  readonly userAgent: string;
  readonly policyId: string;
  readonly evaluatedAt: string;
}): RobotsDecision {
  return RobotsDecisionSchema.parse({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    status: 'not_checked',
    policyId: input.policyId,
    userAgent: input.userAgent,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl ?? input.requestedUrl,
    evaluatedAt: input.evaluatedAt,
    decisionPath: ['robots_not_evaluated'],
  });
}

export function makeUnknownRightsStatus(input: {
  readonly policyId: string;
  readonly observedAt: string;
}): SourceRightsStatus {
  return SourceRightsStatusSchema.parse({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    status: 'unknown',
    observationMethod: 'not_observed',
    exactLocator: null,
    sourceValue: null,
    observedAt: input.observedAt,
    policyId: input.policyId,
  });
}

export function buildTruthfulRetrievalAttempt(input: {
  readonly attemptId: string;
  readonly candidateId: string;
  readonly effectId: string;
  readonly requestedUrl: string;
  readonly finalUrl?: string;
  readonly status: RetrievalTerminalStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly retrievedAt?: string;
  readonly dateObservation?: SourceDateObservation;
  readonly dateVerdict?: DateExtractionVerdict;
  readonly robotsDecision: RobotsDecision;
  readonly rightsStatus: SourceRightsStatus;
  readonly bytes: number;
  readonly failure?: RetrievalFailure;
}): RetrievalAttempt {
  const observation = input.dateObservation
    ? SourceDateObservationSchema.parse(input.dateObservation)
    : null;
  const verdict = input.dateVerdict
    ? DateExtractionVerdictSchema.parse(input.dateVerdict)
    : null;
  if ((observation === null) !== (verdict === null)) {
    throw new P9RetrievalResidueError(
      'incomplete_date_evidence',
      'publication date observation and verdict must be supplied together',
    );
  }
  if (
    observation &&
    verdict &&
    (verdict.observationId !== observation.observationId ||
      verdict.observationDigest !== canonicalDigest(observation))
  ) {
    throw new P9RetrievalResidueError(
      'date_verdict_identity_mismatch',
      'publication date verdict does not bind the exact observation',
    );
  }
  const publishedAt =
    observation && verdict?.verdict === 'accepted'
      ? observation.normalizedValue
      : null;
  return RetrievalAttemptSchema.parse({
    schemaVersion: '1.0.0',
    contractFamily: 'p9.v1',
    attemptId: input.attemptId,
    candidateId: input.candidateId,
    effectId: input.effectId,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl ?? null,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    retrievedAt: input.retrievedAt ?? null,
    publishedAt,
    dateObservation: observation,
    dateVerdict: verdict,
    robotsDecision: RobotsDecisionSchema.parse(input.robotsDecision),
    rightsStatus: SourceRightsStatusSchema.parse(input.rightsStatus),
    bytes: input.bytes,
    failure: input.failure ?? null,
  });
}

const TERMINAL_STATUSES = RetrievalTerminalStatusSchema.options;

/** Tracks every candidate selected for acquisition until typed terminal residue exists. */
export class P9RetrievalResidueLedger {
  readonly #selected = new Map<string, SelectedRetrievalCandidate>();
  readonly #attempts = new Map<string, RetrievalAttempt>();
  readonly #candidateTerminal = new Map<string, string>();

  select(candidate: SelectedRetrievalCandidate): void {
    if (
      !candidate.candidateId.trim() ||
      !candidate.sourceClass.trim() ||
      !candidate.selectedAt.trim()
    ) {
      throw new P9RetrievalResidueError(
        'invalid_selected_candidate',
        'selected candidate requires identities, source class, and timestamp',
      );
    }
    new URL(candidate.requestedUrl);
    const existing = this.#selected.get(candidate.candidateId);
    if (existing) {
      if (canonicalDigest(existing) === canonicalDigest(candidate)) return;
      throw new P9RetrievalResidueError(
        'selected_candidate_conflict',
        'candidate identity was selected with different acquisition inputs',
      );
    }
    this.#selected.set(candidate.candidateId, structuredClone(candidate));
  }

  recordTerminal(input: RetrievalAttempt): RetrievalAttempt {
    const attempt = RetrievalAttemptSchema.parse(input);
    const selected = this.#selected.get(attempt.candidateId);
    if (!selected) {
      throw new P9RetrievalResidueError(
        'candidate_not_selected',
        'terminal retrieval attempt references an unselected candidate',
      );
    }
    if (selected.requestedUrl !== attempt.requestedUrl) {
      throw new P9RetrievalResidueError(
        'candidate_url_mismatch',
        'terminal retrieval attempt changed the selected requested URL',
      );
    }
    const existingAttempt = this.#attempts.get(attempt.attemptId);
    if (existingAttempt) {
      if (canonicalDigest(existingAttempt) === canonicalDigest(attempt)) {
        return structuredClone(existingAttempt);
      }
      throw new P9RetrievalResidueError(
        'attempt_identity_conflict',
        'retrieval attempt identity was reused for different residue',
      );
    }
    const terminalAttemptId = this.#candidateTerminal.get(attempt.candidateId);
    if (terminalAttemptId) {
      throw new P9RetrievalResidueError(
        'candidate_already_terminal',
        `candidate already has terminal attempt ${terminalAttemptId}`,
      );
    }
    this.#attempts.set(attempt.attemptId, structuredClone(attempt));
    this.#candidateTerminal.set(attempt.candidateId, attempt.attemptId);
    return structuredClone(attempt);
  }

  getAttempt(id: string): RetrievalAttempt | undefined {
    const attempt = this.#attempts.get(id);
    return attempt ? structuredClone(attempt) : undefined;
  }

  assess(input: {
    readonly missingSourceClasses: readonly string[];
    readonly assessedAt: string;
  }): RetrievalCoverageResidue {
    const attemptsByStatus = Object.fromEntries(
      TERMINAL_STATUSES.map((status) => [status, 0]),
    ) as Record<RetrievalTerminalStatus, number>;
    for (const attempt of this.#attempts.values()) {
      attemptsByStatus[attempt.status] += 1;
    }
    const missingCandidateIds = [...this.#selected.keys()]
      .filter((candidateId) => !this.#candidateTerminal.has(candidateId))
      .sort();
    return RetrievalCoverageResidueSchema.parse({
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      selectedCandidateIds: [...this.#selected.keys()].sort(),
      terminalAttemptIds: [...this.#attempts.keys()].sort(),
      attemptsByStatus,
      missingCandidateIds,
      missingSourceClasses: [...new Set(input.missingSourceClasses)].sort(),
      assessedAt: input.assessedAt,
    });
  }

  assertComplete(input: {
    readonly missingSourceClasses: readonly string[];
    readonly assessedAt: string;
  }): RetrievalCoverageResidue {
    const residue = this.assess(input);
    if (residue.missingCandidateIds.length > 0) {
      throw new P9RetrievalResidueError(
        'incomplete_retrieval_residue',
        `selected candidates lack terminal attempts: ${residue.missingCandidateIds.join(', ')}`,
      );
    }
    return residue;
  }
}
