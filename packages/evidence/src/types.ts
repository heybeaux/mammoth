export type EvidenceKind =
  | 'web_snapshot'
  | 'paper'
  | 'dataset'
  | 'source_code'
  | 'test_output'
  | 'benchmark_output'
  | 'formal_proof'
  | 'human_attestation'
  | 'receipt'
  | 'system_observation'
  | 'model_observation';

export interface EvidenceArtifact {
  id: string;
  kind: EvidenceKind;
  retrievedAt: string;
  expiresAt?: string;
  contentDigest: string;
  sourceLineageId: string;
}

export interface ClaimEvidenceEdge {
  claimId: string;
  evidenceId: string;
  stance: 'supports' | 'contradicts' | 'context';
  entailment: 'direct' | 'partial' | 'none' | 'uncertain';
  locator: {
    page?: number;
    section?: string;
    startOffset?: number;
    endOffset?: number;
    jsonPath?: string;
    lineStart?: number;
    lineEnd?: number;
  };
}

export interface EvidencePolicyInput {
  claimId: string;
  artifacts: EvidenceArtifact[];
  edges: ClaimEvidenceEdge[];
  evaluatedAt: string;
}

export type EvidenceReason =
  | 'DIRECT_FRESH_SUPPORT'
  | 'NO_SUPPORTING_EDGE'
  | 'NON_ENTAILING_SUPPORT'
  | 'MISSING_LOCATOR'
  | 'STALE_EVIDENCE'
  | 'MISSING_ARTIFACT'
  | 'CROSS_MODEL_ONLY';

export interface EvidenceVerdict {
  trusted: boolean;
  status: 'supported' | 'unresolved' | 'expired';
  reasons: EvidenceReason[];
  acceptedEvidenceIds: string[];
}

export interface HandoffField {
  name: string;
  wire: string;
  concept: string;
  unit: string;
  expectedDigest: string;
}

export interface HandoffManifest {
  contractId: string;
  requiredClaimIds: string[];
  requiredEvidenceIds: string[];
  fields: HandoffField[];
}

export interface HandoffPayload {
  contractId: string;
  claimIds: string[];
  evidenceIds: string[];
  fields: Partial<HandoffField>[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ReceiptBody {
  id: string;
  claim: string;
  changes: unknown[];
  evidenceIds: string[];
  verificationChecks: string[];
  artifactHashes: Record<string, string>;
  issuedAt: string;
}

export interface Receipt extends ReceiptBody {
  integrityHash: string;
}

export interface AuditEvent {
  streamId: string;
  sequence: number;
  previousHash: string;
  eventHash: string;
  payload: unknown;
}
