import { contentDigest } from '@mammoth/retrieval';
import { describe, expect, it } from 'vitest';

import {
  ProductionContentAddressedStore,
  type ArtifactMetadata,
  type CasByteBackend,
  type CasMetadataPort,
  type CasMetadataTransaction,
  type StagedObject,
} from '../src/index.js';

class FakeBytes implements CasByteBackend {
  readonly staged = new Map<string, Uint8Array>();
  readonly published = new Map<string, Uint8Array>();
  readonly quarantined = new Map<string, Uint8Array>();
  truncateStage = false;
  wrongPublishedDigest = false;
  private nextId = 0;

  async stage(bytes: Uint8Array): Promise<StagedObject> {
    await Promise.resolve();
    const id = String(this.nextId++);
    const value = this.truncateStage
      ? bytes.slice(0, -1)
      : Uint8Array.from(bytes);
    this.staged.set(id, value);
    return { id };
  }

  async readStaged(staged: StagedObject): Promise<Uint8Array> {
    await Promise.resolve();
    return this.required(this.staged, staged.id);
  }

  async discard(staged: StagedObject): Promise<void> {
    await Promise.resolve();
    this.staged.delete(staged.id);
  }

  async publishIfAbsent(staged: StagedObject, digest: string) {
    await Promise.resolve();
    const candidate = this.required(this.staged, staged.id);
    if (!this.published.has(digest)) {
      this.published.set(digest, Uint8Array.from(candidate));
    }
    this.staged.delete(staged.id);
    return {
      digest: this.wrongPublishedDigest ? `sha256:${'0'.repeat(64)}` : digest,
      storageUri: `cas://${digest}`,
    };
  }

  async read(digest: string): Promise<Uint8Array> {
    await Promise.resolve();
    return this.required(this.published, digest);
  }

  async *listDigests(): AsyncIterable<string> {
    await Promise.resolve();
    for (const digest of this.published.keys()) yield digest;
  }

  async quarantine(digest: string): Promise<void> {
    await Promise.resolve();
    const value = this.required(this.published, digest);
    this.quarantined.set(digest, value);
    this.published.delete(digest);
  }

  private required(map: Map<string, Uint8Array>, key: string): Uint8Array {
    const value = map.get(key);
    if (value === undefined) throw new Error(`missing ${key}`);
    return Uint8Array.from(value);
  }
}

class FakeMetadata implements CasMetadataPort {
  readonly records = new Map<string, ArtifactMetadata>();

  async transaction<T>(
    operation: (transaction: CasMetadataTransaction) => Promise<T>,
  ): Promise<T> {
    return operation({
      get: async (digest) => {
        await Promise.resolve();
        return this.records.get(digest);
      },
      createOrVerify: async (metadata) => {
        await Promise.resolve();
        const existing = this.records.get(metadata.digest);
        if (existing !== undefined)
          return { status: 'existing', metadata: existing };
        this.records.set(metadata.digest, metadata);
        return { status: 'created', metadata };
      },
    });
  }

  async *listDigests(): AsyncIterable<string> {
    await Promise.resolve();
    for (const digest of this.records.keys()) yield digest;
  }
}

function fixture() {
  const bytes = new FakeBytes();
  const metadata = new FakeMetadata();
  return {
    bytes,
    metadata,
    open: () => new ProductionContentAddressedStore(bytes, metadata),
  };
}

describe('ProductionContentAddressedStore', () => {
  it('verifies before publishing and deduplicates identical puts', async () => {
    const shared = fixture();
    const value = new TextEncoder().encode('immutable');
    const first = await shared.open().put(value);
    const second = await shared.open().put(value);

    expect(second).toEqual(first);
    expect(shared.bytes.published).toHaveLength(1);
    expect(shared.metadata.records).toHaveLength(1);
  });

  it('survives adapter restart and returns defensive byte copies', async () => {
    const shared = fixture();
    const value = new TextEncoder().encode('restart-safe');
    const stored = await shared.open().put(value);
    const read = await shared.open().get(stored.digest);
    read[0] = 0;
    expect(await shared.open().get(stored.digest)).toEqual(value);
  });

  it('rejects invalid digests before consulting storage', async () => {
    await expect(fixture().open().get('sha256:not-a-digest')).rejects.toThrow(
      /INVALID_DIGEST/,
    );
  });

  it('fails a truncated staged write without publishing metadata or bytes', async () => {
    const shared = fixture();
    shared.bytes.truncateStage = true;
    await expect(
      shared.open().put(new TextEncoder().encode('truncate-me')),
    ).rejects.toThrow(/INTEGRITY_FAILURE/);
    expect(shared.bytes.published).toHaveLength(0);
    expect(shared.bytes.staged).toHaveLength(0);
    expect(shared.metadata.records).toHaveLength(0);
  });

  it('fails closed when an existing digest contains colliding or tampered bytes', async () => {
    const shared = fixture();
    const value = new TextEncoder().encode('expected');
    const digest = contentDigest(value);
    shared.bytes.published.set(digest, new TextEncoder().encode('malicious'));

    await expect(shared.open().put(value)).rejects.toThrow(/INTEGRITY_FAILURE/);
    expect(shared.metadata.records).toHaveLength(0);
  });

  it('rejects a backend that reports a different published digest', async () => {
    const shared = fixture();
    shared.bytes.wrongPublishedDigest = true;
    await expect(
      shared.open().put(new TextEncoder().encode('wrong digest')),
    ).rejects.toThrow(/INTEGRITY_FAILURE/);
    expect(shared.metadata.records).toHaveLength(0);
  });

  it('verifies digest and metadata size on every read', async () => {
    const shared = fixture();
    const value = new TextEncoder().encode('verify every time');
    const stored = await shared.open().put(value);
    shared.bytes.published.set(
      stored.digest,
      new TextEncoder().encode('tampered'),
    );
    await expect(shared.open().get(stored.digest)).rejects.toThrow(
      /INTEGRITY_FAILURE/,
    );

    shared.bytes.published.set(stored.digest, value);
    shared.metadata.records.set(stored.digest, { ...stored, size: 1 });
    await expect(shared.open().get(stored.digest)).rejects.toThrow(
      /INTEGRITY_FAILURE/,
    );
  });

  it('fails closed on conflicting existing metadata', async () => {
    const shared = fixture();
    const value = new TextEncoder().encode('metadata conflict');
    const digest = contentDigest(value);
    shared.metadata.records.set(digest, {
      digest,
      size: value.byteLength,
      storageUri: 'cas://wrong-location',
    });
    await expect(shared.open().put(value)).rejects.toThrow(/METADATA_CONFLICT/);
  });

  it('reports and deterministically quarantines only unreferenced objects', async () => {
    const shared = fixture();
    const referenced = await shared
      .open()
      .put(new TextEncoder().encode('kept'));
    const orphanBytes = new TextEncoder().encode('orphan');
    const orphan = contentDigest(orphanBytes);
    shared.bytes.published.set(orphan, orphanBytes);

    expect(await shared.open().listOrphans()).toEqual([
      { digest: orphan, action: 'reported' },
    ]);
    expect(await shared.open().reconcileOrphans({ quarantine: true })).toEqual([
      { digest: orphan, action: 'quarantined' },
    ]);
    expect(shared.bytes.published.has(referenced.digest)).toBe(true);
    expect(shared.bytes.quarantined.has(orphan)).toBe(true);
  });

  it('does not fabricate metadata when metadata publication fails', async () => {
    const shared = fixture();
    shared.metadata.transaction = async () => {
      await Promise.resolve();
      throw new Error('transaction aborted');
    };
    const value = new TextEncoder().encode('becomes an inspectable orphan');
    const digest = contentDigest(value);
    await expect(shared.open().put(value)).rejects.toThrow(
      /transaction aborted/,
    );
    expect(shared.bytes.published.has(digest)).toBe(true);
    expect(shared.metadata.records.has(digest)).toBe(false);
  });
});
