import { contentDigest } from '@mammoth/retrieval';
import type { CasObject, ContentAddressedStore } from '@mammoth/retrieval';

import { ProductionCasError } from './errors.js';
import type {
  ArtifactMetadata,
  CasByteBackend,
  CasMetadataPort,
  StagedObject,
} from './ports.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;

export interface OrphanRecord {
  readonly digest: string;
  readonly action: 'reported' | 'quarantined';
}

export class ProductionContentAddressedStore implements ContentAddressedStore {
  constructor(
    private readonly bytes: CasByteBackend,
    private readonly metadata: CasMetadataPort,
  ) {}

  async put(input: Uint8Array): Promise<CasObject> {
    const value = Uint8Array.from(input);
    const digest = contentDigest(value);
    let staged: StagedObject | undefined;
    try {
      staged = await this.bytes.stage(value);
      this.assertBytes(
        digest,
        await this.bytes.readStaged(staged),
        'staged write',
      );
      const published = await this.bytes.publishIfAbsent(staged, digest);
      staged = undefined;
      if (published.digest !== digest) {
        throw new ProductionCasError(
          'INTEGRITY_FAILURE',
          `backend published ${published.digest} for ${digest}`,
        );
      }
      const persisted = await this.bytes.read(digest);
      this.assertBytes(digest, persisted, 'published object');
      if (persisted.byteLength !== value.byteLength) {
        throw new ProductionCasError(
          'INTEGRITY_FAILURE',
          `size mismatch at ${digest}`,
        );
      }
      const candidate: ArtifactMetadata = {
        digest,
        size: value.byteLength,
        storageUri: published.storageUri,
      };
      const result = await this.metadata.transaction((transaction) =>
        transaction.createOrVerify(candidate),
      );
      this.assertMetadata(candidate, result.metadata);
      return result.metadata;
    } finally {
      if (staged !== undefined) await this.bytes.discard(staged);
    }
  }

  async get(digest: string): Promise<Uint8Array> {
    this.assertDigest(digest);
    const metadata = await this.metadata.transaction((transaction) =>
      transaction.get(digest),
    );
    if (metadata === undefined) {
      throw new ProductionCasError(
        'CONTENT_MISSING',
        `no metadata for ${digest}`,
      );
    }
    let value: Uint8Array;
    try {
      value = await this.bytes.read(digest);
    } catch (cause) {
      throw new ProductionCasError(
        'CONTENT_MISSING',
        `bytes unavailable for ${digest}`,
        { cause },
      );
    }
    this.assertBytes(digest, value, 'read');
    if (value.byteLength !== metadata.size) {
      throw new ProductionCasError(
        'INTEGRITY_FAILURE',
        `metadata size does not match bytes for ${digest}`,
      );
    }
    return Uint8Array.from(value);
  }

  async listOrphans(): Promise<readonly OrphanRecord[]> {
    const referenced = new Set<string>();
    for await (const digest of this.metadata.listDigests())
      referenced.add(digest);
    const records: OrphanRecord[] = [];
    for await (const digest of this.bytes.listDigests()) {
      if (!referenced.has(digest)) records.push({ digest, action: 'reported' });
    }
    return records.sort((left, right) =>
      left.digest.localeCompare(right.digest),
    );
  }

  async reconcileOrphans(options: {
    readonly quarantine: boolean;
  }): Promise<readonly OrphanRecord[]> {
    const orphans = await this.listOrphans();
    if (!options.quarantine) return orphans;
    const reconciled: OrphanRecord[] = [];
    for (const orphan of orphans) {
      await this.bytes.quarantine(orphan.digest, 'unreferenced CAS object');
      reconciled.push({ digest: orphan.digest, action: 'quarantined' });
    }
    return reconciled;
  }

  private assertDigest(digest: string): void {
    if (!DIGEST.test(digest)) {
      throw new ProductionCasError('INVALID_DIGEST', digest);
    }
  }

  private assertBytes(
    digest: string,
    bytes: Uint8Array,
    location: string,
  ): void {
    if (contentDigest(bytes) !== digest) {
      throw new ProductionCasError(
        'INTEGRITY_FAILURE',
        `${location} digest mismatch for ${digest}`,
      );
    }
  }

  private assertMetadata(
    expected: ArtifactMetadata,
    actual: ArtifactMetadata,
  ): void {
    if (
      actual.digest !== expected.digest ||
      actual.size !== expected.size ||
      actual.storageUri !== expected.storageUri
    ) {
      throw new ProductionCasError(
        'METADATA_CONFLICT',
        `existing metadata differs for ${expected.digest}`,
      );
    }
  }
}
