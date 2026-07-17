export interface Outcome1FixtureSource {
  readonly sourceId: string;
  readonly sourceClass: string;
  readonly sourceFamily: string;
  readonly bodyFile: string;
  readonly position: 'supporting' | 'contradicting' | 'context';
}

export interface Outcome1Corpus {
  readonly schemaVersion: '1.0.0';
  readonly caseId: string;
  readonly corpusId: string;
  readonly sources: readonly Outcome1FixtureSource[];
  readonly contradictionPairs: readonly {
    readonly leftSourceId: string;
    readonly rightSourceId: string;
    readonly issue: string;
  }[];
  readonly falsifier: string;
  readonly decoyClaim: string;
}

export interface Outcome1Case {
  readonly caseId: string;
  readonly domain: 'technical' | 'policy' | 'scientific';
  readonly question: string;
  readonly corpusFile: string;
  readonly uniqueSourceCanary: string;
  readonly answerObligations: readonly string[];
  readonly requiredPreviewRoles: readonly string[];
  readonly forbiddenCrossFixtureFingerprints: readonly string[];
}

export interface Outcome1Manifest {
  readonly schemaVersion: '1.0.0';
  readonly contractFamily: 'outcome-1.v1';
  readonly publicCommand: 'investigate';
  readonly expectedPreviewExitCode: 0;
  readonly expectedPreviewStatus: 'awaiting_approval';
  readonly requiredPreviewArtifacts: readonly string[];
  readonly requiredReaderArtifacts: readonly string[];
  readonly requiredAuditArtifacts: readonly string[];
  readonly genericSourceTargets: readonly string[];
  readonly legacyForbiddenFingerprints: readonly string[];
  readonly cases: readonly Outcome1Case[];
}

export interface Outcome1Preview {
  readonly caseId: string;
  readonly question: string;
  readonly status: 'awaiting_approval';
  readonly effectCount: number;
  readonly problemContract: {
    readonly objective: string;
    readonly assumptions: readonly string[];
    readonly falsifiers: readonly string[];
  };
  readonly teamPlan: {
    readonly roles: readonly {
      readonly roleId: string;
      readonly reason: string;
    }[];
  };
  readonly researchPlan: {
    readonly queries: readonly string[];
    readonly evidenceRequirements: readonly string[];
    readonly reportSections: readonly string[];
  };
}

export interface Outcome1VerificationResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}
