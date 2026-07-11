import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalJsonLedger } from '@mammoth/persistence';
import { FileContentStore } from '@mammoth/retrieval';
import { DurableWorkRuntime, LocalWorkStateStore } from '@mammoth/work-queue';
import { LocalWorkflowStore } from '@mammoth/workflow';
import { afterEach, describe, it } from 'vitest';
import {
  verifyEpistemicLedgerConformance,
  verifyContentAddressedStoreConformance,
  verifyEffectReceiptConformance,
  verifyWorkStateStoreConformance,
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

  it('passes work-state durability and atomicity', async () => {
    const root = await temporaryRoot();
    const path = join(root, 'work-state.json');
    verifyWorkStateStoreConformance({
      open: () => new LocalWorkStateStore(path),
    });
  });

  it('persists completed effect receipts across runtime restart', async () => {
    const root = await temporaryRoot();
    const path = join(root, 'effect-state.json');
    await verifyEffectReceiptConformance({
      open: () => new DurableWorkRuntime(new LocalWorkStateStore(path)),
    });
  });

  it('deduplicates artifact bytes and rejects tampering', async () => {
    const root = await temporaryRoot();
    const store = new FileContentStore(root);
    await verifyContentAddressedStoreConformance({
      open: () => new FileContentStore(root),
      corrupt: async (digest) => {
        const path = store.pathFor(digest);
        await chmod(path, 0o640);
        await writeFile(path, 'tampered');
      },
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mammoth-adapter-contracts-'));
  roots.push(root);
  return root;
}
