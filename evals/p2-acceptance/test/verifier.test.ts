import assert from 'node:assert/strict';
import test from 'node:test';
import {
  P2_GATES,
  verifyP2,
  type GateSpec,
  type GateTarget,
  type VerifierDependencies,
} from '../src/verifier.js';

function dependencies(options: {
  targets?: Readonly<Record<string, GateTarget>>;
  existing?: readonly string[];
  exits?: Readonly<Record<string, number>>;
  invalid?: string;
  calls?: string[];
}): VerifierDependencies {
  return {
    exists: (path) => Promise.resolve((options.existing ?? []).includes(path)),
    validateTarget: () => Promise.resolve(options.invalid),
    resolveTarget: (gate) =>
      Promise.resolve(options.targets?.[gate.id] ?? gate.defaultTarget),
    run: (command) => {
      const key = command.join(' ');
      options.calls?.push(key);
      return Promise.resolve({ exitCode: options.exits?.[key] ?? 0 });
    },
  };
}

void test('the production skeleton fails closed for every unregistered capability', async () => {
  const result = await verifyP2(
    '/repo',
    dependencies({ existing: [] }),
    P2_GATES,
  );
  assert.equal(result.ok, false);
  assert.equal(result.gates.length, P2_GATES.length);
  assert.ok(result.gates.some(({ status }) => status === 'missing'));
  assert.equal(
    result.gates.find(({ id }) => id === 'd3-content-addressed-artifacts')
      ?.diagnostic,
    'no executable capability registered for gate: d3-content-addressed-artifacts',
  );
});

void test('a missing required path is not executed and remains missing', async () => {
  const calls: string[] = [];
  const gate: GateSpec = {
    id: 'fixture',
    description: 'fixture',
    defaultTarget: {
      requiredPath: 'service/package.json',
      command: ['pnpm', 'test'],
    },
  };
  const result = await verifyP2('/repo', dependencies({ calls }), [gate]);
  assert.equal(result.ok, false);
  assert.equal(result.gates[0]?.status, 'missing');
  assert.deepEqual(calls, []);
});

void test('a package without the named executable gate is not treated as passing', async () => {
  const calls: string[] = [];
  const gate: GateSpec = {
    id: 'fixture',
    description: 'fixture',
    defaultTarget: {
      requiredPath: 'service/package.json',
      command: ['pnpm', 'test:acceptance'],
    },
  };
  const result = await verifyP2(
    '/repo',
    dependencies({
      existing: ['/repo/service/package.json'],
      invalid: 'required executable package script is absent: test:acceptance',
      calls,
    }),
    [gate],
  );
  assert.equal(result.ok, false);
  assert.equal(result.gates[0]?.status, 'missing');
  assert.deepEqual(calls, []);
});

void test('all registered executable gates must return zero', async () => {
  const calls: string[] = [];
  const gates: GateSpec[] = [
    { id: 'a', description: 'a' },
    { id: 'b', description: 'b' },
  ];
  const targets = {
    a: { requiredPath: 'a', command: ['pnpm', 'a'] },
    b: { requiredPath: 'b', command: ['pnpm', 'b'] },
  } satisfies Record<string, GateTarget>;
  const result = await verifyP2(
    '/repo',
    dependencies({
      targets,
      existing: ['/repo/a', '/repo/b'],
      exits: { 'pnpm a': 0, 'pnpm b': 7 },
      calls,
    }),
    gates,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.gates.map(({ status }) => status),
    ['passed', 'failed'],
  );
  assert.deepEqual(calls, ['pnpm a', 'pnpm b']);
});

void test('a fully registered, present, successful gate set is accepted deterministically', async () => {
  const gate: GateSpec = { id: 'fixture', description: 'fixture' };
  const result = await verifyP2(
    '/repo',
    dependencies({
      targets: {
        fixture: { requiredPath: 'fixture', command: ['pnpm', 'fixture'] },
      },
      existing: ['/repo/fixture'],
    }),
    [gate],
  );
  assert.deepEqual(result, {
    ok: true,
    verifier: 'mammoth-p2-acceptance-v1',
    gates: [
      {
        id: 'fixture',
        status: 'passed',
        description: 'fixture',
        requiredPath: 'fixture',
        command: ['pnpm', 'fixture'],
        exitCode: 0,
      },
    ],
  });
});

void test('duplicate gate IDs are rejected before any command runs', async () => {
  const gate: GateSpec = { id: 'same', description: 'same' };
  await assert.rejects(
    verifyP2('/repo', dependencies({}), [gate, gate]),
    /P2_VERIFIER_DUPLICATE_GATE:same/,
  );
});
