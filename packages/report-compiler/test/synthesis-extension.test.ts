import { describe, expect, it } from 'vitest';
import {
  SYNTHESIS_EXTENSION_CONTRACT_FAMILY,
  SynthesisExtensionIntegrityError,
  renderSynthesisReaderLines,
  synthesisInternalIdentities,
  validateSynthesisExtension,
  type SynthesisExtension,
} from '../src/index.js';

const searchedAt = '2026-07-15T00:00:00.000Z';

const domains = [
  {
    label: 'materials',
    sourceDomain: 'battery electrode manufacturing',
    targetDomain: 'ceramic membrane sintering',
    sharedMechanism:
      'porosity gradients control diffusion-limited throughput under thermal stress',
    nonEquivalence: 'membrane feedstock lacks binder burnout residues',
    boundary: 'holds only below the phase-transition temperature band',
    prediction: 'graded sintering profiles raise permeate flux',
    falsifier: 'no flux difference across graded and uniform profiles',
    hypothesis:
      'a two-stage gradient firing schedule increases membrane throughput without cracking',
    uncertainty: 'whether gradient firing preserves structural integrity',
    intervention:
      'fire matched membrane batches under two-stage and uniform schedules',
    evaluator: 'blinded flux-and-crack scoring against a preregistered rubric',
    threshold:
      'at least fifteen percent median flux gain with no crack increase',
    budget: 'twelve laboratory hours and two material batches',
    safetyBoundary: 'existing kiln limits; no new equipment or reagents',
  },
  {
    label: 'logistics',
    sourceDomain: 'hospital triage queueing',
    targetDomain: 'port container yard scheduling',
    sharedMechanism:
      'priority inversion under bursty arrivals degrades worst-case wait times',
    nonEquivalence:
      'containers cannot self-report deterioration the way patients can',
    boundary: 'requires arrival bursts shorter than the reordering window',
    prediction:
      'aging-based promotion reduces tail latency for low-priority items',
    falsifier: 'tail wait times unchanged after promotion policy is enabled',
    hypothesis:
      'an aging-promotion rule cuts worst-case container dwell time during peak season',
    uncertainty: 'whether promotion rules destabilize crane utilization',
    intervention:
      'replay one season of yard logs through simulated promotion policies',
    evaluator: 'deterministic replay simulator with fixed seeds',
    threshold: 'ninety-fifth percentile dwell time falls by ten percent',
    budget: 'four compute hours on local hardware',
    safetyBoundary: 'simulation only; no live yard systems are touched',
  },
] as const;

function fixture(domain: (typeof domains)[number]): {
  extension: SynthesisExtension;
  admitted: Set<string>;
} {
  const prefix = domain.label;
  const claimId = `claim:${prefix}:admitted`;
  const mechanismId = `mechanism:${prefix}:transfer`;
  const hypothesisId = `hypothesis:${prefix}:candidate`;
  const extension: SynthesisExtension = {
    schemaVersion: '1.0.0',
    contractFamily: SYNTHESIS_EXTENSION_CONTRACT_FAMILY,
    mechanisms: [
      {
        mechanismId,
        sourceDomain: domain.sourceDomain,
        targetDomain: domain.targetDomain,
        sharedMechanism: domain.sharedMechanism,
        nonEquivalences: [domain.nonEquivalence],
        boundaryConditions: [domain.boundary],
        predictions: [domain.prediction],
        falsifiers: [domain.falsifier],
        priorArtChallenge: {
          searchedAt,
          scope: `bounded ${domain.sourceDomain} literature search`,
          finding: `no prior transfer into ${domain.targetDomain} was located`,
        },
        supportingClaimIds: [claimId],
      },
    ],
    hypotheses: [
      {
        hypothesisId,
        label: 'cross_domain_hypothesis',
        statement: domain.hypothesis,
        derivedFromClaimIds: [claimId],
        mechanismIds: [mechanismId],
        falsifiers: [domain.falsifier],
      },
    ],
    experimentProposals: [
      {
        proposalId: `experiment:${prefix}:decisive`,
        hypothesisIds: [hypothesisId],
        uncertainty: domain.uncertainty,
        intervention: domain.intervention,
        evaluator: domain.evaluator,
        threshold: domain.threshold,
        budget: domain.budget,
        safetyBoundary: domain.safetyBoundary,
        falsifier: domain.falsifier,
      },
    ],
  };
  return { extension, admitted: new Set([claimId]) };
}

describe('research synthesis extension', () => {
  for (const domain of domains) {
    it(`validates and renders a ${domain.label} synthesis through the same generic contract`, () => {
      const { extension, admitted } = fixture(domain);
      const validated = validateSynthesisExtension(extension, admitted);
      const lines = renderSynthesisReaderLines(validated, {
        citationNumbersForClaim: () => [1],
      });
      const markdown = lines.join('\n');

      expect(markdown).toContain('## Cross-domain mechanisms');
      expect(markdown).toContain(domain.sharedMechanism);
      expect(markdown).toContain(
        `${domain.sourceDomain} → ${domain.targetDomain}`,
      );
      expect(markdown).toContain(
        `Does not transfer when: ${domain.nonEquivalence}.`,
      );
      expect(markdown).toContain(
        `- *Cross-domain hypothesis:* ${domain.hypothesis}[1]`,
      );
      expect(markdown).toContain(
        `Resolves uncertainty: ${domain.uncertainty}.`,
      );
      expect(markdown).toContain(`Threshold: ${domain.threshold}.`);
      expect(markdown).toContain(`Safety boundary: ${domain.safetyBoundary}.`);
      expect(markdown).toContain(`Falsifier: ${domain.falsifier}.`);
      for (const identity of synthesisInternalIdentities(validated)) {
        expect(markdown).not.toContain(identity);
      }
      expect(markdown).not.toContain('sha256:');
    });
  }

  it('produces entirely distinct prose for unrelated domains', () => {
    const first = renderSynthesisReaderLines(
      validateSynthesisExtension(
        fixture(domains[0]).extension,
        fixture(domains[0]).admitted,
      ),
    );
    const second = renderSynthesisReaderLines(
      validateSynthesisExtension(
        fixture(domains[1]).extension,
        fixture(domains[1]).admitted,
      ),
    );
    const structural = new Set([
      '',
      '## Cross-domain mechanisms',
      '## Hypotheses',
      '## Proposed experiments',
    ]);
    const shared = first.filter(
      (line) => second.includes(line) && !structural.has(line),
    );
    expect(shared).toEqual([]);
  });

  it('rejects mechanisms and hypotheses not derived from admitted evidence', () => {
    const { extension } = fixture(domains[0]);
    expect(() =>
      validateSynthesisExtension(extension, new Set<string>()),
    ).toThrowError(SynthesisExtensionIntegrityError);
    expect(() =>
      validateSynthesisExtension(extension, new Set<string>()),
    ).toThrowError(/not derived from admitted evidence/u);
  });

  it('rejects experiment proposals missing any decisive field', () => {
    const { extension, admitted } = fixture(domains[0]);
    for (const field of [
      'uncertainty',
      'intervention',
      'evaluator',
      'threshold',
      'budget',
      'safetyBoundary',
      'falsifier',
    ] as const) {
      const invalid = {
        ...extension,
        experimentProposals: [
          { ...extension.experimentProposals[0], [field]: '' },
        ],
      };
      expect(() => validateSynthesisExtension(invalid, admitted)).toThrowError(
        SynthesisExtensionIntegrityError,
      );
    }
  });

  it('rejects dangling mechanism and hypothesis references', () => {
    const { extension, admitted } = fixture(domains[1]);
    const danglingMechanism = {
      ...extension,
      hypotheses: [
        {
          ...extension.hypotheses[0],
          mechanismIds: ['mechanism:missing'],
        },
      ],
    };
    expect(() =>
      validateSynthesisExtension(danglingMechanism, admitted),
    ).toThrowError(/unknown mechanism/u);
    const danglingHypothesis = {
      ...extension,
      experimentProposals: [
        {
          ...extension.experimentProposals[0],
          hypothesisIds: ['hypothesis:missing'],
        },
      ],
    };
    expect(() =>
      validateSynthesisExtension(danglingHypothesis, admitted),
    ).toThrowError(/unknown hypothesis/u);
  });

  it('requires prior-art records for apparently novel hypotheses and mechanisms for cross-domain ones', () => {
    const { extension, admitted } = fixture(domains[0]);
    const novelWithoutPriorArt = {
      ...extension,
      hypotheses: [
        {
          ...extension.hypotheses[0],
          label: 'apparently_novel_hypothesis' as const,
        },
      ],
    };
    expect(() =>
      validateSynthesisExtension(novelWithoutPriorArt, admitted),
    ).toThrowError(/prior-art/u);
    const crossDomainWithoutMechanism = {
      ...extension,
      hypotheses: [
        {
          ...extension.hypotheses[0],
          mechanismIds: [],
        },
      ],
    };
    expect(() =>
      validateSynthesisExtension(crossDomainWithoutMechanism, admitted),
    ).toThrowError(/mechanism transfer/u);
  });

  it('renders nothing for an empty extension and stays deterministic', () => {
    const empty: SynthesisExtension = {
      schemaVersion: '1.0.0',
      contractFamily: SYNTHESIS_EXTENSION_CONTRACT_FAMILY,
      mechanisms: [],
      hypotheses: [],
      experimentProposals: [],
    };
    expect(
      renderSynthesisReaderLines(validateSynthesisExtension(empty, new Set())),
    ).toEqual([]);
    const { extension, admitted } = fixture(domains[0]);
    const validated = validateSynthesisExtension(extension, admitted);
    expect(renderSynthesisReaderLines(validated)).toEqual(
      renderSynthesisReaderLines(validated),
    );
  });
});
