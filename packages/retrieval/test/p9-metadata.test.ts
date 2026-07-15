import {
  canonicalDigest,
  RetrievalAttemptSchema,
  RobotsDecisionSchema,
  type DateExtractionVerdict,
  type SourceDateObservation,
} from '@mammoth/domain';
import { describe, expect, it } from 'vitest';
import {
  buildTruthfulRetrievalAttempt,
  makeNotCheckedRobotsDecision,
  makeUnknownRightsStatus,
  P9RetrievalResidueLedger,
} from '../src/index.js';

const NOW = '2026-07-15T02:00:00.000Z';
const REQUESTED = 'https://example.com/research';

const robots = () =>
  makeNotCheckedRobotsDecision({
    requestedUrl: REQUESTED,
    userAgent: 'MammothP9/0.9',
    policyId: 'robots-policy/v1',
    evaluatedAt: NOW,
  });

const rights = () =>
  makeUnknownRightsStatus({ policyId: 'rights-policy/v1', observedAt: NOW });

function failure(code: string) {
  return {
    code,
    message: code,
    retryable: false,
    policyEffect: 'fail_closed' as const,
  };
}

describe('P9 truthful source metadata', () => {
  it('never copies retrieval time into publication time', () => {
    const attempt = buildTruthfulRetrievalAttempt({
      attemptId: 'attempt-1',
      candidateId: 'candidate-1',
      effectId: 'effect-1',
      requestedUrl: REQUESTED,
      finalUrl: REQUESTED,
      status: 'admitted',
      startedAt: NOW,
      finishedAt: NOW,
      retrievedAt: NOW,
      robotsDecision: robots(),
      rightsStatus: rights(),
      bytes: 1200,
    });

    expect(attempt.retrievedAt).toBe(NOW);
    expect(attempt.publishedAt).toBeNull();
    expect(attempt.robotsDecision.status).toBe('not_checked');
    expect(attempt.rightsStatus.status).toBe('unknown');
  });

  it('admits a publication date only from a digest-bound accepted observation', () => {
    const observation: SourceDateObservation = {
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      observationId: 'published-observation-1',
      field: 'published_at',
      extractionMethod: 'html_metadata',
      exactLocator: 'meta[property="article:published_time"]@content',
      sourceValue: '2026-06-01T12:00:00Z',
      normalizedValue: '2026-06-01T12:00:00.000Z',
      confidence: 1,
      observedAt: NOW,
    };
    const verdict: DateExtractionVerdict = {
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      observationId: observation.observationId,
      observationDigest: canonicalDigest(observation),
      verdict: 'accepted',
      policyId: 'date-extraction/v1',
      reason: 'machine-readable publication field parsed exactly',
      decidedAt: NOW,
    };
    const attempt = buildTruthfulRetrievalAttempt({
      attemptId: 'attempt-date',
      candidateId: 'candidate-date',
      effectId: 'effect-date',
      requestedUrl: REQUESTED,
      status: 'admitted',
      startedAt: NOW,
      finishedAt: NOW,
      retrievedAt: NOW,
      dateObservation: observation,
      dateVerdict: verdict,
      robotsDecision: robots(),
      rightsStatus: rights(),
      bytes: 100,
    });

    expect(attempt.publishedAt).toBe(observation.normalizedValue);
    expect(() =>
      buildTruthfulRetrievalAttempt({
        attemptId: 'attempt-date-tampered',
        candidateId: 'candidate-date',
        effectId: 'effect-date',
        requestedUrl: REQUESTED,
        status: 'admitted',
        startedAt: NOW,
        finishedAt: NOW,
        dateObservation: observation,
        dateVerdict: {
          ...verdict,
          observationDigest: canonicalDigest('wrong'),
        },
        robotsDecision: robots(),
        rightsStatus: rights(),
        bytes: 100,
      }),
    ).toThrowError(/does not bind the exact observation/);
    expect(() =>
      RetrievalAttemptSchema.parse({
        ...attempt,
        dateVerdict: {
          ...verdict,
          observationDigest: canonicalDigest('wrong'),
        },
      }),
    ).toThrowError(/must bind the exact supplied observation/);
  });

  it('requires actual robots evidence before claiming allowed or denied', () => {
    expect(() =>
      RobotsDecisionSchema.parse({
        ...robots(),
        status: 'allowed',
        decisionPath: [],
      }),
    ).toThrowError(/requires evaluated bytes\/receipt/);
  });
});

describe('P9 retrieval residue', () => {
  it('fails until every selected candidate has typed terminal residue', () => {
    const ledger = new P9RetrievalResidueLedger();
    ledger.select({
      candidateId: 'candidate-1',
      sourceClass: 'primary_government',
      requestedUrl: REQUESTED,
      selectedAt: NOW,
    });

    expect(() =>
      ledger.assertComplete({ missingSourceClasses: [], assessedAt: NOW }),
    ).toThrowError(/candidate-1/);
    expect(
      ledger.assess({ missingSourceClasses: [], assessedAt: NOW })
        .missingCandidateIds,
    ).toEqual(['candidate-1']);
  });

  it('preserves rejected, denied, timed-out, rate-limited, and unknown outcomes', () => {
    const ledger = new P9RetrievalResidueLedger();
    const statuses = [
      'rejected',
      'denied',
      'timed_out',
      'rate_limited',
      'unknown',
    ] as const;
    for (const [index, status] of statuses.entries()) {
      const candidateId = `candidate-${String(index)}`;
      const requestedUrl = `https://example.com/${String(index)}`;
      ledger.select({
        candidateId,
        sourceClass:
          index === 0 ? 'vendor_documentation' : 'independent_analysis',
        requestedUrl,
        selectedAt: NOW,
      });
      ledger.recordTerminal(
        buildTruthfulRetrievalAttempt({
          attemptId: `attempt-${String(index)}`,
          candidateId,
          effectId: `effect-${String(index)}`,
          requestedUrl,
          status,
          startedAt: NOW,
          finishedAt: NOW,
          robotsDecision: makeNotCheckedRobotsDecision({
            requestedUrl,
            userAgent: 'MammothP9/0.9',
            policyId: 'robots-policy/v1',
            evaluatedAt: NOW,
          }),
          rightsStatus: rights(),
          bytes: 0,
          failure: failure(`retrieval_${status}`),
        }),
      );
    }

    const residue = ledger.assertComplete({
      missingSourceClasses: ['security_audit'],
      assessedAt: NOW,
    });
    expect(residue.missingCandidateIds).toEqual([]);
    expect(residue.missingSourceClasses).toEqual(['security_audit']);
    for (const status of statuses)
      expect(residue.attemptsByStatus[status]).toBe(1);
  });

  it('rejects non-admitted outcomes without typed failure residue', () => {
    expect(() =>
      buildTruthfulRetrievalAttempt({
        attemptId: 'attempt-missing-failure',
        candidateId: 'candidate-missing-failure',
        effectId: 'effect-missing-failure',
        requestedUrl: REQUESTED,
        status: 'unavailable',
        startedAt: NOW,
        finishedAt: NOW,
        robotsDecision: robots(),
        rightsStatus: rights(),
        bytes: 0,
      }),
    ).toThrowError(/requires typed failure residue/);
  });
});
