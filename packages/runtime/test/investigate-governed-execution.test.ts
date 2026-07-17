import { createHash } from 'node:crypto';
import {
  P9LiveAuthorityReceiptSchema,
  type InvestigationPlan,
} from '@mammoth/domain';
import {
  bindApprovedInvestigationPlan,
  recordInvestigationApproval,
} from '@mammoth/governance';
import { describe, expect, it } from 'vitest';
import {
  buildOfflineNoEffectAdapters,
  composeGovernedInvestigationBundle,
  deriveAcquisitionIntents,
  evaluateAcquisitionRelease,
  executeGovernedAcquisition,
  GovernedExecutionError,
  mintOfflineFixtureAuthorityReceipt,
  OFFLINE_FIXTURE_ISSUER_ID,
  planInvestigation,
  type GovernedNoEffectAdapters,
} from '../src/index.js';

const NOW = '2026-07-16T12:00:00.000Z';
const QUESTION =
  'How can a small coastal museum extend the usable life of its climate control system with a limited maintenance budget?';

const CATALOG = {
  schemaVersion: '1.0.0',
  catalogId: 'runtime-test-catalog/v1',
  sourceClasses: [
    { sourceClass: 'primary', minimumIndependentSources: 1, mandatory: true },
    {
      sourceClass: 'secondary',
      minimumIndependentSources: 1,
      mandatory: false,
    },
  ],
  sources: [
    {
      url: 'https://facilities.example.org/reports/hvac-condition',
      sourceClass: 'primary',
      title: 'Facilities condition report',
      mediaType: 'text/plain' as const,
      body: 'The facilities assessment recorded that filter replacements were overdue in both gallery air handlers at the time of inspection. Technicians measured a fifteen percent efficiency loss attributable to fouled coils in the oldest unit. The assessment recommended quarterly coil cleaning as the highest-value low-cost intervention.',
    },
    {
      url: 'https://practice.example.org/guides/preventive-maintenance',
      sourceClass: 'secondary',
      title: 'Preventive maintenance guide',
      mediaType: 'text/plain' as const,
      body: 'Published maintenance guides state that scheduled inspection of belts and dampers extends compressor life in mid-sized institutional systems. Institutions that logged runtime hours before failures reported fewer emergency repairs in the following year.',
    },
  ],
};

function boundPlan(question: string, decidedAt = NOW): InvestigationPlan {
  const preview = planInvestigation(question);
  const approval = recordInvestigationApproval({
    approvalId: `approval:${preview.investigationId}`,
    investigationId: preview.investigationId,
    previewDigest: preview.previewDigest,
    decision: 'approve',
    actorId: 'operator:test',
    actorKind: 'human_operator',
    reason: 'test approval for governed execution',
    decidedAt,
  });
  const result = bindApprovedInvestigationPlan({ preview, approval });
  if (!result.plan) {
    throw new Error(
      `plan binding rejected: ${result.receipt.reasonCodes.join(',')}`,
    );
  }
  return result.plan;
}

interface Scenario {
  readonly plan: InvestigationPlan;
  readonly intentSet: ReturnType<typeof deriveAcquisitionIntents>;
  readonly authority: ReturnType<typeof mintOfflineFixtureAuthorityReceipt>;
  readonly release: ReturnType<typeof evaluateAcquisitionRelease>;
}

function authorizedScenario(question = QUESTION): Scenario {
  const plan = boundPlan(question);
  const intentSet = deriveAcquisitionIntents(plan);
  const authority = mintOfflineFixtureAuthorityReceipt({
    planId: plan.planId,
    planDigest: plan.planDigest,
    question: plan.question,
    actorId: 'operator:test',
    authorizedAt: NOW,
  });
  const release = evaluateAcquisitionRelease({
    intentSet,
    effectAuthority: authority,
    trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
    now: NOW,
  });
  return { plan, intentSet, authority, release };
}

function countedAdapters(): {
  readonly adapters: GovernedNoEffectAdapters;
  readonly counts: { searches: number; retrievals: number };
} {
  const inner = buildOfflineNoEffectAdapters(CATALOG);
  const counts = { searches: 0, retrievals: 0 };
  return {
    counts,
    adapters: {
      sourceClassTargets: inner.sourceClassTargets,
      search: (query) => {
        counts.searches += 1;
        return inner.search(query);
      },
      retrieve: (url) => {
        counts.retrievals += 1;
        return inner.retrieve(url);
      },
    },
  };
}

describe('offline fixture authority', () => {
  it('mints a deterministic schema-valid receipt bound to the exact plan and question', () => {
    const plan = boundPlan(QUESTION);
    const mint = () =>
      mintOfflineFixtureAuthorityReceipt({
        planId: plan.planId,
        planDigest: plan.planDigest,
        question: plan.question,
        actorId: 'operator:test',
        authorizedAt: NOW,
      });
    const receipt = mint();
    expect(P9LiveAuthorityReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt.issuerId).toBe(OFFLINE_FIXTURE_ISSUER_ID);
    expect(receipt.planScope.planDigest).toBe(plan.planDigest);
    expect(receipt.planScope.question).toBe(plan.question);
    expect(mint()).toEqual(receipt);
  });

  it('refuses a nonpositive validity window', () => {
    const plan = boundPlan(QUESTION);
    expect(() =>
      mintOfflineFixtureAuthorityReceipt({
        planId: plan.planId,
        planDigest: plan.planDigest,
        question: plan.question,
        actorId: 'operator:test',
        authorizedAt: NOW,
        validityMinutes: 0,
      }),
    ).toThrow(/positive validity window/u);
  });
});

describe('offline no-effect adapters', () => {
  it('serves only declared bytes and returns null for undeclared urls', () => {
    const adapters = buildOfflineNoEffectAdapters(CATALOG);
    const hit = adapters.retrieve(
      'https://facilities.example.org/reports/hvac-condition',
    );
    expect(hit).not.toBeNull();
    expect(new TextDecoder().decode(hit?.bytes)).toContain(
      'filter replacements were overdue',
    );
    expect(
      adapters.retrieve('https://facilities.example.org/reports/undeclared'),
    ).toBeNull();
    expect(adapters.search('any planned query')).toHaveLength(
      CATALOG.sources.length,
    );
  });

  it('rejects a malformed catalog', () => {
    expect(() =>
      buildOfflineNoEffectAdapters({ schemaVersion: '1.0.0' }),
    ).toThrow();
  });
});

describe('governed acquisition execution', () => {
  it('executes an authorized release end to end with inspectable receipts and residue', () => {
    const scenario = authorizedScenario();
    const { adapters } = countedAdapters();
    const execution = executeGovernedAcquisition({
      intentSet: scenario.intentSet,
      release: scenario.release,
      effectAuthority: scenario.authority,
      trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      adapters,
      now: NOW,
    });
    expect(execution.planDigest).toBe(scenario.plan.planDigest);
    expect(execution.intentReceipts).toHaveLength(
      scenario.intentSet.intents.length,
    );
    expect(execution.snapshots.length).toBeGreaterThan(0);
    expect(execution.retrievalAttempts.length).toBeGreaterThan(0);
    expect(
      execution.retrievalAttempts.every(
        (attempt) => attempt.status === 'admitted',
      ),
    ).toBe(true);
    const admitted = execution.claims.filter(
      (claim) => claim.decision === 'admitted',
    );
    const rejected = execution.claims.filter(
      (claim) => claim.decision !== 'admitted',
    );
    expect(admitted.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThan(0);
    // Duplicate hints across planned queries become inspectable residue.
    expect(
      execution.rejectedHints.some(
        (hint) => hint.reason === 'duplicate_source',
      ),
    ).toBe(true);
    // Proposer and evaluator are independent for every adjudicated claim.
    expect(execution.proposals).toHaveLength(execution.verdicts.length);
    for (const [index, proposal] of execution.proposals.entries()) {
      const verdict = execution.verdicts[index];
      expect(verdict?.proposalDigest).toBe(proposal.proposalDigest);
      expect(verdict?.evaluatorWork.profileFamilyId).not.toBe(
        proposal.proposerWork.profileFamilyId,
      );
    }
  });

  it('is deterministic for a fixed clock and catalog', () => {
    const scenario = authorizedScenario();
    const run = () =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      });
    expect(run()).toEqual(run());
  });

  it('refuses a refused release before touching any adapter', () => {
    const scenario = authorizedScenario();
    const refusedRelease = evaluateAcquisitionRelease({
      intentSet: scenario.intentSet,
      effectAuthority: scenario.authority,
      now: NOW,
    });
    expect(refusedRelease.decision).toBe('refused');
    const { adapters, counts } = countedAdapters();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: refusedRelease,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters,
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({ code: 'release_not_authorized' }) as Error,
    );
    expect(counts).toEqual({ searches: 0, retrievals: 0 });
  });

  it('refuses when no trusted issuer is pinned at the execution boundary', () => {
    const scenario = authorizedScenario();
    const { adapters, counts } = countedAdapters();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: undefined,
        adapters,
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'no_trusted_authority_issuer',
      }) as Error,
    );
    expect(counts).toEqual({ searches: 0, retrievals: 0 });
  });

  it('refuses an issuer that differs from the pinned issuer', () => {
    const scenario = authorizedScenario();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: 'some-other-issuer/v1',
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({ code: 'untrusted_authority_issuer' }) as Error,
    );
  });

  it('refuses a digest-tampered intent set', () => {
    const scenario = authorizedScenario();
    const tampered = JSON.parse(JSON.stringify(scenario.intentSet)) as Record<
      string,
      unknown
    > & {
      intents: { subject: string }[];
    };
    const firstIntent = tampered.intents[0];
    if (!firstIntent) throw new Error('expected at least one intent');
    firstIntent.subject = `${firstIntent.subject} tampered`;
    expect(() =>
      executeGovernedAcquisition({
        intentSet: tampered,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow();
  });

  it('refuses an intent set the release never bound', () => {
    const scenario = authorizedScenario();
    const other = authorizedScenario(
      'Which watershed monitoring cadence best detects new contamination without exhausting volunteer capacity?',
    );
    expect(() =>
      executeGovernedAcquisition({
        intentSet: other.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'release_intent_set_mismatch',
      }) as Error,
    );
  });

  it('refuses an authority that is not the one the release bound', () => {
    const scenario = authorizedScenario();
    const swapped = mintOfflineFixtureAuthorityReceipt({
      planId: scenario.plan.planId,
      planDigest: scenario.plan.planDigest,
      question: scenario.plan.question,
      actorId: 'operator:test',
      authorizedAt: NOW,
      consumptionNonce: 'different-nonce-0123456789abcdef',
    });
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: swapped,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'authority_release_binding_mismatch',
      }) as Error,
    );
  });

  it('refuses an expired authority at execution time', () => {
    const scenario = authorizedScenario();
    const { adapters, counts } = countedAdapters();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters,
        now: '2026-07-16T14:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'authority_expired' }) as Error);
    expect(counts).toEqual({ searches: 0, retrievals: 0 });
  });

  it('refuses an authority that is not yet valid', () => {
    const scenario = authorizedScenario();
    expect(() =>
      executeGovernedAcquisition({
        intentSet: scenario.intentSet,
        release: scenario.release,
        effectAuthority: scenario.authority,
        trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
        adapters: buildOfflineNoEffectAdapters(CATALOG),
        now: '2026-07-16T11:00:00.000Z',
      }),
    ).toThrow(
      expect.objectContaining({ code: 'authority_not_yet_valid' }) as Error,
    );
  });
});

describe('governed investigation bundle', () => {
  function sha256(value: string): string {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
  }

  it('composes a digest-chained reader and audit bundle from admitted evidence only', () => {
    const scenario = authorizedScenario();
    const execution = executeGovernedAcquisition({
      intentSet: scenario.intentSet,
      release: scenario.release,
      effectAuthority: scenario.authority,
      trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      adapters: buildOfflineNoEffectAdapters(CATALOG),
      now: NOW,
    });
    const bundle = composeGovernedInvestigationBundle({
      plan: scenario.plan,
      intentSet: scenario.intentSet,
      release: scenario.release,
      execution,
      now: NOW,
    });
    const report = bundle.files['reader/report.md'] ?? '';
    expect(report).toMatch(/^#\s+/u);
    expect(report).toContain('## Direct answer');
    expect(report).toMatch(/\[\d+\]/u);
    expect(report).not.toMatch(
      /sha256:|claim[_:-]|proposal[_:-]|plan digest|parser receipt|budget ledger|coverage verdict/iu,
    );
    expect(bundle.files['reader/references.md']).toMatch(
      /^\[\d+\]:\s+https:\/\//mu,
    );
    expect(
      (bundle.files['audit/rejected-claims.jsonl'] ?? '').trim().length,
    ).toBeGreaterThan(0);
    const receipt = JSON.parse(
      bundle.files['execution-receipt.json'] ?? '{}',
    ) as { artifactDigests: Record<string, string> };
    for (const [name, content] of Object.entries(bundle.files)) {
      if (name === 'execution-receipt.json') continue;
      expect(receipt.artifactDigests[name]).toBe(sha256(content));
    }
    const projection = JSON.parse(
      bundle.files['reader/projection.json'] ?? '{}',
    ) as {
      factualSentences: { claimIds: string[] }[];
    };
    const admittedIds = new Set(
      execution.claims
        .filter((claim) => claim.decision === 'admitted')
        .map((claim) => claim.proposalId),
    );
    expect(projection.factualSentences.length).toBeGreaterThan(0);
    for (const sentence of projection.factualSentences) {
      expect(sentence.claimIds.length).toBeGreaterThan(0);
      for (const id of sentence.claimIds) {
        expect(admittedIds.has(id)).toBe(true);
      }
    }
  });

  it('refuses to compose across mismatched lineage', () => {
    const scenario = authorizedScenario();
    const other = authorizedScenario(
      'Which watershed monitoring cadence best detects new contamination without exhausting volunteer capacity?',
    );
    const execution = executeGovernedAcquisition({
      intentSet: scenario.intentSet,
      release: scenario.release,
      effectAuthority: scenario.authority,
      trustedIssuerId: OFFLINE_FIXTURE_ISSUER_ID,
      adapters: buildOfflineNoEffectAdapters(CATALOG),
      now: NOW,
    });
    expect(() =>
      composeGovernedInvestigationBundle({
        plan: other.plan,
        intentSet: scenario.intentSet,
        release: scenario.release,
        execution,
        now: NOW,
      }),
    ).toThrow(GovernedExecutionError);
  });
});
