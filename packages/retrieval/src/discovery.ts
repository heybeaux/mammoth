import {
  canonicalDigest,
  type PlannedSearchQuery,
  type SourceClassTarget,
} from '@mammoth/domain';
import type { SelectedRetrievalCandidate } from './p9-metadata.js';
import { canonicalizeAcquisitionUrl } from './security.js';

/**
 * A discovery result is a hint, never evidence. Hints carry the plan query
 * that produced them and a source-class label assigned by inspectable caller
 * policy (for example a domain pack classifier), not by this module.
 */
export interface DiscoveredSourceHint {
  readonly queryId: string;
  readonly url: string;
  readonly sourceClass: string;
  readonly title?: string;
  readonly description?: string;
}

export interface PlannedDiscoveryScope {
  readonly searchQueries: readonly PlannedSearchQuery[];
  readonly sourceClassTargets: readonly SourceClassTarget[];
}

export type HintRejectionReason =
  | 'query_not_planned'
  | 'source_class_not_planned'
  | 'url_not_permitted'
  | 'low_relevance_hint'
  | 'duplicate_source'
  | 'source_class_capacity_exhausted';

export interface RejectedSourceHint {
  readonly hint: DiscoveredSourceHint;
  readonly reason: HintRejectionReason;
}

export interface PlannedCandidateSelection {
  readonly candidates: readonly SelectedRetrievalCandidate[];
  readonly rejected: readonly RejectedSourceHint[];
}

export class PlannedDiscoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlannedDiscoveryError';
  }
}

/**
 * Deterministically selects acquisition candidates from discovery hints under
 * an accepted plan. Every selected candidate traces to a planned query and a
 * planned source class; everything else becomes inspectable rejection
 * residue. The function is domain-generic: it contains no hostnames, topics,
 * privileged URLs, or expected conclusions, and it performs no effects.
 */
export function selectPlannedAcquisitionCandidates(input: {
  readonly scope: PlannedDiscoveryScope;
  readonly hints: readonly DiscoveredSourceHint[];
  readonly selectedAt: string;
  readonly allowedSchemes?: readonly string[];
  readonly maxCandidatesPerSourceClass?: number;
}): PlannedCandidateSelection {
  if (!input.selectedAt.trim()) {
    throw new PlannedDiscoveryError(
      'missing_selection_time',
      'candidate selection requires a selection timestamp',
    );
  }
  if (
    input.maxCandidatesPerSourceClass !== undefined &&
    (!Number.isInteger(input.maxCandidatesPerSourceClass) ||
      input.maxCandidatesPerSourceClass < 1)
  ) {
    throw new PlannedDiscoveryError(
      'invalid_source_class_capacity',
      'per-source-class capacity must be a positive integer when supplied',
    );
  }
  const allowedSchemes = input.allowedSchemes ?? ['https:'];
  const plannedQueryIds = new Set(
    input.scope.searchQueries.map((query) => query.queryId),
  );
  const plannedSourceClasses = new Set(
    input.scope.sourceClassTargets.map((target) => target.sourceClass),
  );
  const selectedUrls = new Set<string>();
  const perClassCounts = new Map<string, number>();
  const candidates: SelectedRetrievalCandidate[] = [];
  const rejected: RejectedSourceHint[] = [];

  const reject = (hint: DiscoveredSourceHint, reason: HintRejectionReason) => {
    rejected.push({ hint, reason });
  };

  for (const hint of input.hints) {
    if (!plannedQueryIds.has(hint.queryId)) {
      reject(hint, 'query_not_planned');
      continue;
    }
    if (!plannedSourceClasses.has(hint.sourceClass)) {
      reject(hint, 'source_class_not_planned');
      continue;
    }
    let canonicalUrl: URL;
    try {
      canonicalUrl = canonicalizeAcquisitionUrl(hint.url);
    } catch {
      reject(hint, 'url_not_permitted');
      continue;
    }
    if (!allowedSchemes.includes(canonicalUrl.protocol)) {
      reject(hint, 'url_not_permitted');
      continue;
    }
    if (selectedUrls.has(canonicalUrl.href)) {
      reject(hint, 'duplicate_source');
      continue;
    }
    const used = perClassCounts.get(hint.sourceClass) ?? 0;
    if (
      input.maxCandidatesPerSourceClass !== undefined &&
      used >= input.maxCandidatesPerSourceClass
    ) {
      reject(hint, 'source_class_capacity_exhausted');
      continue;
    }
    selectedUrls.add(canonicalUrl.href);
    perClassCounts.set(hint.sourceClass, used + 1);
    candidates.push({
      candidateId: `discovered:${canonicalDigest(canonicalUrl.href).slice(7, 23)}`,
      sourceClass: hint.sourceClass,
      requestedUrl: canonicalUrl.href,
      selectedAt: input.selectedAt,
    });
  }
  return { candidates, rejected };
}

/**
 * Reports which planned source classes received no selected candidate, so
 * coverage gaps stay plan-relative and inspectable before acquisition begins.
 */
export function unservedPlannedSourceClasses(
  scope: PlannedDiscoveryScope,
  selection: PlannedCandidateSelection,
): readonly string[] {
  const served = new Set(
    selection.candidates.map((candidate) => candidate.sourceClass),
  );
  return scope.sourceClassTargets
    .map((target) => target.sourceClass)
    .filter((sourceClass) => !served.has(sourceClass))
    .sort();
}
