import type { FileContentStore } from './cas.js';
import { parseSource } from './parse.js';
import { retrieveSource } from './retrieve.js';
import type { SourceRequest, SourceSnapshot } from './types.js';

export async function snapshotSource(
  request: SourceRequest,
  store: FileContentStore,
  retrievalOptions: Parameters<typeof retrieveSource>[1] = {},
): Promise<SourceSnapshot> {
  const retrieved = await retrieveSource(request, retrievalOptions);
  const contentObject = await store.put(retrieved.bytes);
  const parsedArtifact = parseSource(retrieved.bytes, retrieved.mediaType);
  const parsedObject = await store.put(
    new TextEncoder().encode(parsedArtifact.text),
  );
  return {
    requestedUrl: retrieved.requestedUrl,
    finalUrl: retrieved.finalUrl,
    redirectChain: retrieved.redirectChain,
    retrievedAt: retrieved.retrievedAt,
    status: retrieved.status,
    headers: retrieved.headers,
    mediaType: retrieved.mediaType,
    contentDigest: contentObject.digest,
    contentSize: contentObject.size,
    contentObject,
    parsedArtifact,
    parsedObject,
  };
}
