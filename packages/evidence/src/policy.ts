import type {
  ClaimEvidenceEdge,
  EvidencePolicyInput,
  EvidenceReason,
  EvidenceVerdict,
} from './types.js';

function hasLocator(edge: ClaimEvidenceEdge): boolean {
  return Object.keys(edge.locator).length > 0;
}

export function evaluateEvidencePolicy(
  input: EvidencePolicyInput,
): EvidenceVerdict {
  const artifacts = new Map(
    input.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const supporting = input.edges.filter(
    (edge) => edge.claimId === input.claimId && edge.stance === 'supports',
  );
  const reasons = new Set<EvidenceReason>();
  const acceptedEvidenceIds: string[] = [];
  let sawExpired = false;
  let sawModelOnly = false;

  if (supporting.length === 0) reasons.add('NO_SUPPORTING_EDGE');

  for (const edge of supporting) {
    const artifact = artifacts.get(edge.evidenceId);
    if (!artifact) {
      reasons.add('MISSING_ARTIFACT');
      continue;
    }
    if (edge.entailment !== 'direct') {
      reasons.add('NON_ENTAILING_SUPPORT');
      continue;
    }
    if (!hasLocator(edge)) {
      reasons.add('MISSING_LOCATOR');
      continue;
    }
    if (
      artifact.expiresAt &&
      Date.parse(input.evaluatedAt) >= Date.parse(artifact.expiresAt)
    ) {
      reasons.add('STALE_EVIDENCE');
      sawExpired = true;
      continue;
    }
    if (artifact.kind === 'model_observation') {
      sawModelOnly = true;
      continue;
    }
    acceptedEvidenceIds.push(artifact.id);
  }

  if (acceptedEvidenceIds.length > 0) {
    reasons.add('DIRECT_FRESH_SUPPORT');
    return {
      trusted: true,
      status: 'supported',
      reasons: [...reasons].sort(),
      acceptedEvidenceIds: acceptedEvidenceIds.sort(),
    };
  }
  if (sawModelOnly) reasons.add('CROSS_MODEL_ONLY');
  return {
    trusted: false,
    status: sawExpired ? 'expired' : 'unresolved',
    reasons: [...reasons].sort(),
    acceptedEvidenceIds: [],
  };
}
