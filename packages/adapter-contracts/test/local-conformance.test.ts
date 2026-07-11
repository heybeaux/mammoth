import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalJsonLedger } from '@mammoth/persistence';
import { LocalWorkflowStore } from '@mammoth/workflow';
import { afterEach, describe, it } from 'vitest';
import {
  verifyEpistemicLedgerConformance,
  verifyWorkflowStoreConformance,
} from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('local adapter conformance', () => {
  it('passes workflow durability and atomicity', async () => {
    const root = await temporaryRoot();
    const path = join(root, 'workflow.json');
    await verifyWorkflowStoreConformance({
      open: () => new LocalWorkflowStore(path),
    });
  });

  it('passes ledger durability and atomicity', async () => {
    const root = await temporaryRoot();
    const path = join(root, 'ledger.json');
    await verifyEpistemicLedgerConformance({
      open: () => new LocalJsonLedger(path),
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-adapter-contracts-'));
  roots.push(root);
  return root;
}
