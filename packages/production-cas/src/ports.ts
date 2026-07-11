export interface StagedObject {
  readonly id: string;
}

export interface PublishedObject {
  readonly digest: string;
  readonly storageUri: string;
}

/** Byte storage supplies staging plus atomic create-if-absent publication. */
export interface CasByteBackend {
  stage(bytes: Uint8Array): Promise<StagedObject>;
  readStaged(staged: StagedObject): Promise<Uint8Array>;
  discard(staged: StagedObject): Promise<void>;
  publishIfAbsent(
    staged: StagedObject,
    digest: string,
  ): Promise<PublishedObject>;
  read(digest: string): Promise<Uint8Array>;
  listDigests(): AsyncIterable<string>;
  quarantine(digest: string, reason: string): Promise<void>;
}

export interface ArtifactMetadata {
  readonly digest: string;
  readonly size: number;
  readonly storageUri: string;
}

export type MetadataCreateResult =
  | { readonly status: 'created'; readonly metadata: ArtifactMetadata }
  | { readonly status: 'existing'; readonly metadata: ArtifactMetadata };

/** Implementations execute each callback in one metadata transaction. */
export interface CasMetadataTransaction {
  get(digest: string): Promise<ArtifactMetadata | undefined>;
  createOrVerify(metadata: ArtifactMetadata): Promise<MetadataCreateResult>;
}

export interface CasMetadataPort {
  transaction<T>(
    operation: (transaction: CasMetadataTransaction) => Promise<T>,
  ): Promise<T>;
  listDigests(): AsyncIterable<string>;
}
