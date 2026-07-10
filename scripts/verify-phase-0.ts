#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createAuditEvent,
  evaluateEvidencePolicy,
  issueReceipt,
  validateHandoff,
  verifyAuditStream,
  verifyReceipt,
  type ClaimEvidenceEdge,
  type EvidenceArtifact,
  type EvidenceReason,
} from '../packages/evidence/src/index.js';

interface Fixture {
  schemaVersion: number;
  evaluatedAt: string;
  evidenceCases: {
    id: string;
    claimId: string;
    artifact: EvidenceArtifact;
    edge: ClaimEvidenceEdge;
    expected: { trusted: boolean; status: string; reason?: EvidenceReason };
  }[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function validateFixture(value: unknown): Fixture {
  invariant(isRecord(value), 'fixture root must be an object');
  const fixture = value as Partial<Fixture>;
  invariant(fixture.schemaVersion === 1, 'unsupported fixture schemaVersion');
  invariant(
    typeof fixture.evaluatedAt === 'string' &&
      !Number.isNaN(Date.parse(fixture.evaluatedAt)),
    'invalid evaluatedAt',
  );
  invariant(
    Array.isArray(fixture.evidenceCases) && fixture.evidenceCases.length > 0,
    'evidenceCases must be non-empty',
  );
  for (const candidate of fixture.evidenceCases as unknown[]) {
    invariant(isRecord(candidate), 'evidence case must be an object');
    const item = candidate;
    invariant(typeof item.id === 'string', 'case id is required');
    invariant(
      typeof item.claimId === 'string',
      `${item.id}: claimId is required`,
    );
    invariant(
      isRecord(item.artifact) && typeof item.artifact.id === 'string',
      `${item.id}: artifact is required`,
    );
    invariant(
      isRecord(item.edge) && item.edge.claimId === item.claimId,
      `${item.id}: edge claim mismatch`,
    );
    invariant(
      isRecord(item.expected) && typeof item.expected.trusted === 'boolean',
      `${item.id}: expected.trusted is required`,
    );
  }
  return fixture as Fixture;
}

const fixturePath = resolve(
  process.cwd(),
  'evals/epistemic/phase-0-fixtures.json',
);
const fixture = validateFixture(
  JSON.parse(await readFile(fixturePath, 'utf8')),
);
let checks = 0;

for (const testCase of fixture.evidenceCases) {
  const verdict = evaluateEvidencePolicy({
    claimId: testCase.claimId,
    artifacts: [testCase.artifact],
    edges: [testCase.edge],
    evaluatedAt: fixture.evaluatedAt,
  });
  invariant(
    verdict.trusted === testCase.expected.trusted,
    `${testCase.id}: trusted mismatch`,
  );
  invariant(
    verdict.status === testCase.expected.status,
    `${testCase.id}: status mismatch`,
  );
  if (testCase.expected.reason) {
    invariant(
      verdict.reasons.includes(testCase.expected.reason),
      `${testCase.id}: missing ${testCase.expected.reason}`,
    );
  }
  checks += 1;
}

const handoff = validateHandoff(
  {
    contractId: 'handoff-1',
    requiredClaimIds: [],
    requiredEvidenceIds: [],
    fields: [
      {
        name: 'value',
        wire: 'v',
        concept: 'temperature',
        unit: 'degC',
        expectedDigest: 'digest',
      },
    ],
  },
  {
    contractId: 'handoff-1',
    claimIds: [],
    evidenceIds: [],
    fields: [{ name: 'value', wire: 'v' }],
  },
);
invariant(
  !handoff.valid &&
    handoff.errors.some((error) => error.startsWith('MISSING_SEMANTIC:')),
  'semantic omission was accepted',
);
checks += 1;

const receipt = issueReceipt({
  id: 'receipt-1',
  claim: 'fixture passed',
  changes: [],
  evidenceIds: [],
  verificationChecks: ['phase-0'],
  artifactHashes: { fixture: 'a'.repeat(64) },
  issuedAt: fixture.evaluatedAt,
});
invariant(
  !verifyReceipt({ ...receipt, claim: 'tampered' }).valid,
  'tampered receipt was accepted',
);
checks += 1;

const firstEvent = createAuditEvent('program-1', 1, 'GENESIS', {
  state: 'candidate',
});
const secondEvent = createAuditEvent('program-1', 2, firstEvent.eventHash, {
  state: 'supported',
});
invariant(
  !verifyAuditStream([firstEvent, { ...secondEvent, sequence: 3 }]).valid,
  'audit sequence tampering was accepted',
);
checks += 1;

console.log(
  `phase-0 verification ok — cases=${String(fixture.evidenceCases.length)}, checks=${String(checks)}`,
);
