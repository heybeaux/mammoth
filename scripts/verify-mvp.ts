import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Json = Record<string, unknown>;

const repositoryRoot = resolve(import.meta.dirname, '..');
const cli = join(repositoryRoot, 'apps/cli/bin/mammoth.js');
const charter = join(repositoryRoot, 'examples/quickstart/charter.json');
const programId = 'quickstart-example-domains';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`MVP_VERIFICATION_FAILED:${message}`);
}

function command(root: string, ...args: string[]): Json {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  invariant(
    result.status === 0,
    `${args[0] ?? 'unknown'} exited ${String(result.status)}: ${result.stderr}`,
  );
  invariant(result.stderr === '', `${args[0] ?? 'unknown'} wrote stderr`);
  const envelope = JSON.parse(result.stdout) as Json;
  invariant(envelope.ok === true, `${args[0] ?? 'unknown'} returned !ok`);
  invariant(envelope.programId === programId, 'program id changed');
  invariant(root.length > 0, 'temporary root missing');
  return envelope;
}

async function json(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8')) as Json;
}

const root = await mkdtemp(join(tmpdir(), 'mammoth-mvp-'));
const run = command(root, 'run', charter, '--root', root, '--json');
const runResult = run.result as Json;
invariant(run.status === 'completed', 'quickstart did not complete');
invariant(
  JSON.stringify(runResult.supportedClaimIds) ===
    JSON.stringify(['claim:quickstart:reserved-domains']),
  'supported claim set changed',
);
invariant(
  JSON.stringify(runResult.unresolvedClaimIds) ===
    JSON.stringify(['claim:quickstart:https-guarantee']),
  'unsupported claim did not fail closed',
);

const status = command(root, 'status', programId, '--root', root, '--json');
invariant(
  (status.result as Json).status === 'completed',
  'status is not durable',
);
const inspect = command(root, 'inspect', programId, '--root', root, '--json');
invariant(
  (inspect.result as Json).receipt !== undefined,
  'receipt not inspectable',
);

const directory = join(root, programId);
const ledger = await json(join(directory, 'ledger.json'));
const manifest = await json(join(directory, 'manifest.json'));
const receipt = await json(join(directory, 'receipt.json'));
const report = await readFile(join(directory, 'dossier.md'), 'utf8');
const claims = ledger.claims as Json[];
const assessments = ledger.assessments as Json[];
const edges = ledger.claimEvidenceEdges as Json[];
const supported = claims.find(
  (claim) => claim.id === 'claim:quickstart:reserved-domains',
);
const unresolved = claims.find(
  (claim) => claim.id === 'claim:quickstart:https-guarantee',
);
invariant(
  supported?.status === 'supported',
  'supported claim missing from ledger',
);
invariant(
  typeof supported.assessmentId === 'string',
  'supported claim has no named assessment',
);
invariant(
  unresolved?.status === 'unresolved',
  'unsupported claim was promoted',
);
invariant(
  report.includes('reserved example.com, example.net, and example.org'),
  'supported factual sentence missing from dossier',
);
invariant(
  !report.includes('always support HTTPS'),
  'unsupported factual sentence rendered',
);
const assessment = assessments.find(
  (item) => item.id === supported.assessmentId,
);
invariant(
  typeof assessment?.policyId === 'string' &&
    typeof assessment.policyVersion === 'string',
  'supported assessment has no named policy version',
);
const edge = edges.find(
  (item) => item.claimId === 'claim:quickstart:reserved-domains',
);
const locator = edge?.locator as Json | undefined;
invariant(
  typeof locator?.startOffset === 'number' &&
    typeof locator.endOffset === 'number' &&
    typeof edge?.extractionDigest === 'string',
  'supported claim has no exact immutable locator',
);
invariant(
  (manifest.unresolvedIssueIds as string[]).includes(
    'claim:quickstart:https-guarantee',
  ),
  'manifest lost unresolved claim',
);
invariant(receipt.status === 'completed', 'terminal receipt not completed');
invariant(
  typeof receipt.snapshotDigest === 'string' &&
    receipt.snapshotDigest === runResult.snapshotDigest,
  'receipt snapshot digest does not match run',
);

console.log(
  `mvp black-box verification ok — program=${programId}, supported=1, unresolved=1, artifacts=4`,
);
