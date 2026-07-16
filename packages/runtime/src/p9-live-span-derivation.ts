import type { P9ObservedSourceSnapshot } from './p9-generic-research.js';

/**
 * Evaluator-visible snapshot window. Every governed claim span must be
 * derived from this same excerpt so the proposer span universe is always a
 * subset of what the evaluator can verify.
 */
export const P9_LIVE_MAX_SNAPSHOT_EXCERPT = 8_000;

export interface P9GovernedClaimSpan {
  readonly evidenceSpanId: string;
  readonly candidateId: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
  readonly quote: string;
}

const GENERIC_PROSE_BOILERPLATE =
  /chat_template_jinja|<\|(?:system|user|assistant|tool)|\\n\{%-|"availableInferenceProviders"/u;

const GITHUB_REPOSITORY_DOCS_CHROME =
  /^(?:skip to content|navigation menu|toggle navigation|sign in|sign up|code$|issues$|pull requests$|actions$|projects$|security$|insights$|go to file|add file|branches|tags|fork|star|watch|notifications|you signed in with another tab|reload to refresh)\.?$/iu;

const GITHUB_REPOSITORY_DOCS_CHROME_PHRASES =
  /\b(?:GitHub Security|code review and vulnerability reports|Pull requests and Actions|This branch is|Contribute to .* development by creating an account on GitHub)\b/iu;

function isRepositoryDocsBoilerplate(input: {
  readonly quote: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
}): boolean {
  if (
    input.sourceClass !== 'repository_docs' ||
    input.sourceFamilyId !== 'github.com'
  ) {
    return false;
  }
  const normalized = input.quote.replace(/\s+/gu, ' ').trim();
  if (GITHUB_REPOSITORY_DOCS_CHROME.test(normalized)) return true;
  if (GITHUB_REPOSITORY_DOCS_CHROME_PHRASES.test(normalized)) return true;
  const chromeTerms = [
    'pull requests',
    'actions',
    'projects',
    'security',
    'insights',
    'fork',
    'star',
    'watch',
  ].filter((term) => normalized.toLowerCase().includes(term)).length;
  return chromeTerms >= 3;
}

function isGovernedProseSpan(input: {
  readonly quote: string;
  readonly sourceClass: string;
  readonly sourceFamilyId: string;
}): boolean {
  return (
    input.quote.length >= 12 &&
    input.quote.length <= 600 &&
    !GENERIC_PROSE_BOILERPLATE.test(input.quote) &&
    !isRepositoryDocsBoilerplate(input)
  );
}

export function deriveP9GovernedClaimSpans(
  snapshots: readonly P9ObservedSourceSnapshot[],
): readonly P9GovernedClaimSpan[] {
  return snapshots.flatMap((snapshot) => {
    const excerpt = snapshot.body.slice(0, P9_LIVE_MAX_SNAPSHOT_EXCERPT);
    const prose = excerpt
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((quote) => quote.trim())
      .filter((quote) =>
        isGovernedProseSpan({
          quote,
          sourceClass: snapshot.sourceClass,
          sourceFamilyId: snapshot.sourceFamilyId,
        }),
      );
    const metadata =
      snapshot.sourceClass === 'upstream_model_docs'
        ? [
            ...excerpt.matchAll(
              /"(?:id|pipeline_tag|library_name|task)":"[^"\r\n]{1,120}"/gu,
            ),
          ].map((match) => match[0])
        : [];
    return [...new Set([...prose, ...metadata])].map((quote, index) => ({
      evidenceSpanId: snapshot.candidateId + ':span:' + String(index),
      candidateId: snapshot.candidateId,
      sourceClass: snapshot.sourceClass,
      sourceFamilyId: snapshot.sourceFamilyId,
      quote,
    }));
  });
}
