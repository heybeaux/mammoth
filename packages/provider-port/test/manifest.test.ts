import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  P7ContractManifestSchema,
  p7ContractManifestDigest,
} from '../src/index.js';

async function readManifest(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      resolve(process.cwd(), '../../evals/fixtures/p7/contracts/manifest.json'),
      'utf8',
    ),
  ) as unknown;
}

describe('P7 frozen contract manifest', () => {
  it('pins contract versions, dependency direction, and authority', async () => {
    const manifest = P7ContractManifestSchema.parse(await readManifest());
    expect(manifest.manifestDigest).toBe(p7ContractManifestDigest(manifest));
    expect(manifest.dependencyDirection).toEqual([
      { source: '@mammoth/domain', mayDependOn: [] },
      { source: '@mammoth/workflow', mayDependOn: ['@mammoth/domain'] },
      { source: '@mammoth/provider-port', mayDependOn: ['@mammoth/domain'] },
      {
        source: 'p7-application-service',
        mayDependOn: [
          '@mammoth/domain',
          '@mammoth/workflow',
          '@mammoth/provider-port',
        ],
      },
    ]);
    expect(manifest.authority.validationAndAdmission).toBe(
      'deterministic-application-service',
    );
  });

  it('fails closed on version or dependency drift', async () => {
    const manifest = P7ContractManifestSchema.parse(await readManifest());
    expect(() =>
      P7ContractManifestSchema.parse({
        ...manifest,
        contracts: { ...manifest.contracts, workflowVersion: 2 },
      }),
    ).toThrow();
    expect(() =>
      P7ContractManifestSchema.parse({
        ...manifest,
        dependencyDirection: manifest.dependencyDirection.map((entry) =>
          entry.source === '@mammoth/domain'
            ? { ...entry, mayDependOn: ['provider-sdk'] }
            : entry,
        ),
      }),
    ).toThrow('P7 contract manifest digest is not canonical');
  });
});
