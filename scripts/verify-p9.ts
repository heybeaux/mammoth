import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = join(root, 'evals/fixtures/p9');

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(fixtureRoot, path), 'utf8')) as Record<
    string,
    unknown
  >;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`P9_BASELINE_INVALID: ${message}`);
}

const manifest = await json('verifier-manifest.json');
invariant(manifest.contractFamily === 'p9.v1', 'manifest contract family');
const inputs = manifest.inputs;
invariant(
  Array.isArray(inputs) && inputs.length === 10,
  'ten frozen verifier inputs',
);
const inputDigests = manifest.inputDigests;
invariant(inputDigests && typeof inputDigests === 'object', 'input digest map');
await Promise.all(
  inputs.map(async (path) => {
    const relativePath = String(path);
    const bytes = await readFile(join(fixtureRoot, relativePath));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    invariant(
      (inputDigests as Record<string, unknown>)[relativePath] === digest,
      `${relativePath} digest`,
    );
    return json(relativePath);
  }),
);

const planPaths = inputs.filter((path) => String(path).startsWith('plans/'));
invariant(planPaths.length === 4, 'four plan fixtures');
const plans = await Promise.all(planPaths.map((path) => json(String(path))));
const domainPacks = new Set(
  plans.map((plan) => plan.domainPack).filter(Boolean),
);
invariant(domainPacks.size === 3, 'three unrelated domain packs');
for (const plan of plans.filter((candidate) => candidate.domainPack)) {
  invariant(
    Array.isArray(plan.subquestions) && plan.subquestions.length >= 4,
    `${String(plan.fixtureId)} subquestions`,
  );
  invariant(
    Array.isArray(plan.requiredSourceClasses) &&
      plan.requiredSourceClasses.length >= 5,
    `${String(plan.fixtureId)} source classes`,
  );
  invariant(
    Array.isArray(plan.requiredContradictions) &&
      plan.requiredContradictions.length >= 2,
    `${String(plan.fixtureId)} contradictions`,
  );
}

const hostile = await json('hostile-manifest.json');
const cases = hostile.cases;
invariant(Array.isArray(cases) && cases.length >= 20, 'hostile corpus size');
const hostileClasses = new Set(
  cases.map((entry) => (entry as { class?: string }).class),
);
for (const required of [
  'budget',
  'network',
  'parser',
  'metadata',
  'entailment',
  'prompt_injection',
  'retention',
  'future_schema',
  'verifier_gaming',
]) {
  invariant(hostileClasses.has(required), `hostile class ${required}`);
}

const expected = await json('expected-artifacts.json');
invariant(
  expected.baselineStatus === 'frozen_implementation_blocked',
  'T0 cannot claim implementation',
);
invariant(
  Array.isArray(expected.requiredImplementationGates) &&
    expected.requiredImplementationGates.length === 6,
  'six successor implementation gates',
);

const receipt = await json('receipt-schema.json');
invariant(receipt.additionalProperties === false, 'closed receipt schema');

console.log(
  'P9 T0 acceptance baseline ok — fixtures=10 plans=4 hostile=21 implementation=blocked',
);
