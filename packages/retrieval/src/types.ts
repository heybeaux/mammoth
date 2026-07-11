export interface SourceRequest {
  url: string;
  headers?: Readonly<Record<string, string>>;
}

export interface RetrievalPolicy {
  allowedSchemes: readonly string[];
  allowedMediaTypes: readonly string[];
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  allowPrivateNetwork: boolean;
}

export interface TransportResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export type SourceTransport = (
  url: URL,
  init: { headers: Readonly<Record<string, string>>; signal: AbortSignal },
) => Promise<TransportResponse>;

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export interface RetrievedSource {
  requestedUrl: string;
  finalUrl: string;
  redirectChain: readonly string[];
  retrievedAt: string;
  status: number;
  headers: Readonly<Record<string, string>>;
  mediaType: string;
  bytes: Uint8Array;
}

export interface CasObject {
  digest: string;
  size: number;
  storageUri: string;
  /** Local compatibility aid. Production consumers must use the store port. */
  path?: string;
}

export interface ContentAddressedStore {
  put(bytes: Uint8Array): Promise<CasObject>;
  get(digest: string): Promise<Uint8Array>;
}

export interface ParsedArtifact {
  parserId: string;
  parserVersion: string;
  mediaType: string;
  text: string;
}

export interface SourceSnapshot extends Omit<RetrievedSource, 'bytes'> {
  contentDigest: string;
  contentSize: number;
  contentObject: CasObject;
  parsedArtifact: ParsedArtifact;
  parsedObject: CasObject;
}
