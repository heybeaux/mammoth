import type {
  MediaSupportDecision,
  NetworkHopReceipt,
  ParserReceipt,
} from '@mammoth/domain';
export type { NetworkHopReceipt } from '@mammoth/domain';

export interface SourceRequest {
  url: string;
  headers?: Readonly<Record<string, string>>;
}

export interface RetrievalPolicy {
  allowedSchemes: readonly string[];
  allowedMediaTypes: readonly string[];
  allowedPorts: readonly number[];
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
}

export interface TransportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  connectedAddress: string;
}

export interface SourceTransportRequest {
  url: URL;
  approvedAddress: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  maximumResponseBytes: number;
}

export interface SourceTransport {
  request(input: SourceTransportRequest): Promise<TransportResponse>;
}

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
  networkReceipts: readonly NetworkHopReceipt[];
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
  mediaSupportDecision?: MediaSupportDecision;
  parserReceipt?: ParserReceipt;
}

export interface SourceSnapshot extends Omit<RetrievedSource, 'bytes'> {
  contentDigest: string;
  contentSize: number;
  contentObject: CasObject;
  parsedArtifact: ParsedArtifact;
  parsedObject: CasObject;
}
