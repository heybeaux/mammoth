import { describe, expect, it } from 'vitest';
import {
  deriveP9GovernedClaimSpans,
  P9_LIVE_MAX_SNAPSHOT_EXCERPT,
} from '../src/index.js';

const METADATA_SPAN = '"pipeline_tag":"text-generation"';

describe('P9 governed claim span derivation', () => {
  it('derives upstream metadata spans only from the evaluator-visible excerpt', () => {
    const hiddenMetadata = '"library_name":"transformers"';
    const body = `${METADATA_SPAN}${'x'.repeat(P9_LIVE_MAX_SNAPSHOT_EXCERPT)}${hiddenMetadata}`;
    const spans = deriveP9GovernedClaimSpans([
      {
        candidateId: 'cand-model-card',
        body,
        sourceClass: 'upstream_model_docs',
        sourceFamilyId: 'huggingface.co',
      },
    ]);

    const quotes = spans.map((span) => span.quote);
    expect(quotes).toContain(METADATA_SPAN);
    expect(quotes).not.toContain(hiddenMetadata);
  });

  it('keeps every span inside the excerpt the evaluator can verify', () => {
    const body = `${'Sentence one is governed. '.repeat(400)}${METADATA_SPAN}`;
    const spans = deriveP9GovernedClaimSpans([
      {
        candidateId: 'cand-model-card',
        body,
        sourceClass: 'upstream_model_docs',
        sourceFamilyId: 'huggingface.co',
      },
    ]);

    const excerpt = body.slice(0, P9_LIVE_MAX_SNAPSHOT_EXCERPT);
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(excerpt).toContain(span.quote);
    }
  });

  it('rejects GitHub page chrome as repository documentation claim seeds', () => {
    const body = [
      'Skip to content. Navigation Menu. Toggle navigation. Sign in.',
      'Code review and vulnerability reports are available from GitHub Security.',
      'Pull requests and Actions can show cache documentation facts.',
    ].join(' ');
    const spans = deriveP9GovernedClaimSpans([
      {
        candidateId: 'cand-github-html',
        body,
        sourceClass: 'repository_docs',
        sourceFamilyId: 'github.com',
      },
    ]);

    expect(spans).toEqual([]);
  });

  it('keeps substantive repository documentation spans after boilerplate screening', () => {
    const quote =
      'Colibri documentation states that the Metal backend uses zero-copy unified memory for model tensors.';
    const spans = deriveP9GovernedClaimSpans([
      {
        candidateId: 'cand-colibri-readme',
        body: 'Skip to content. Navigation Menu. ' + quote,
        sourceClass: 'repository_docs',
        sourceFamilyId: 'github.com',
      },
    ]);

    expect(spans.map((span) => span.quote)).toEqual([quote]);
  });
});
