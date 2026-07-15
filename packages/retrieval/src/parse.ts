import { createHash } from 'node:crypto';
import {
  canonicalDigest,
  MediaSupportDecisionSchema,
  ParserReceiptSchema,
  type MediaSupportDecision,
  type ParserReceipt,
} from '@mammoth/domain';
import type { ParsedArtifact } from './types.js';

export interface ParserLimits {
  maximumInputBytes: number;
  maximumOutputCharacters: number;
  timeoutMs: number;
  maximumMemoryBytes: number;
  maximumProcesses: number;
}

export interface ParserDescriptor {
  id: string;
  version: string;
  mediaTypes: readonly string[];
  locatorCoordinateSpace: string;
  limits: ParserLimits;
}

interface RegisteredParser {
  descriptor: ParserDescriptor;
  parse(bytes: Uint8Array, mediaType: string): string;
}

export class ParserPolicyError extends Error {
  constructor(
    readonly code: string,
    readonly decision: MediaSupportDecision,
    readonly receipt: ParserReceipt | null,
    cause?: unknown,
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'ParserPolicyError';
  }
}

const TEXT_LIMITS: ParserLimits = {
  maximumInputBytes: 5 * 1024 * 1024,
  maximumOutputCharacters: 5_000_000,
  timeoutMs: 5_000,
  maximumMemoryBytes: 64 * 1024 * 1024,
  maximumProcesses: 1,
};

const TEXT_DESCRIPTOR: ParserDescriptor = {
  id: 'mammoth-deterministic-text',
  version: '2.0.0',
  mediaTypes: ['text/plain', 'text/html', 'application/json'],
  locatorCoordinateSpace: 'utf16-code-units/v1',
  limits: TEXT_LIMITS,
};

function parserDigest(descriptor: ParserDescriptor): string {
  return canonicalDigest(descriptor);
}

function bytesDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith('#'))
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

function parseHtml(html: string): string {
  return decodeEntities(
    html
      .replace(
        /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        ' ',
      )
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseText(bytes: Uint8Array, mediaType: string): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  switch (mediaType) {
    case 'text/plain':
      return decoded.replace(/\r\n?/g, '\n');
    case 'text/html':
      return parseHtml(decoded);
    case 'application/json':
      return JSON.stringify(JSON.parse(decoded), null, 2);
    default:
      throw new Error(`NO_PARSER:${mediaType}`);
  }
}

function sniffMediaType(bytes: Uint8Array): string {
  const prefix = bytes.subarray(0, Math.min(bytes.byteLength, 512));
  if (
    prefix.length >= 5 &&
    prefix[0] === 0x25 &&
    prefix[1] === 0x50 &&
    prefix[2] === 0x44 &&
    prefix[3] === 0x46 &&
    prefix[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  if (prefix[0] === 0x1f && prefix[1] === 0x8b) return 'application/gzip';
  if (
    prefix[0] === 0x50 &&
    prefix[1] === 0x4b &&
    prefix[2] === 0x03 &&
    prefix[3] === 0x04
  ) {
    return 'application/zip';
  }
  if (prefix.includes(0)) return 'application/octet-stream';
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true })
      .decode(prefix)
      .trimStart();
  } catch {
    return 'application/octet-stream';
  }
  if (
    /^(?:<!doctype\s+html|<(?:html|head|body|title|meta|link|main|article|section|div|p|h[1-6]|ul|ol|li|table|script|style)\b)/iu.test(
      decoded,
    )
  ) {
    return 'text/html';
  }
  if (/^[{[]/u.test(decoded)) {
    return 'application/json';
  }
  return 'text/plain';
}

export class BoundedParserRegistry {
  readonly #parsers = new Map<string, RegisteredParser>();

  constructor(
    parsers: readonly RegisteredParser[] = [
      {
        descriptor: TEXT_DESCRIPTOR,
        parse: parseText,
      },
    ],
  ) {
    for (const parser of parsers) {
      for (const mediaType of parser.descriptor.mediaTypes) {
        if (this.#parsers.has(mediaType)) {
          throw new Error(`DUPLICATE_PARSER:${mediaType}`);
        }
        this.#parsers.set(mediaType, parser);
      }
    }
  }

  parse(
    bytes: Uint8Array,
    declaredMediaType: string,
    options: {
      sourceUrl?: string;
      now?: () => Date;
      policyId?: string;
      decisionId?: string;
      receiptId?: string;
    } = {},
  ): ParsedArtifact {
    const now = options.now ?? (() => new Date());
    const decidedAt = now().toISOString();
    const sniffed = sniffMediaType(bytes);
    const extensionMatch = options.sourceUrl
      ? /(\.[a-z0-9]+)$/iu.exec(new URL(options.sourceUrl).pathname)
      : null;
    const extension = extensionMatch?.[1]?.toLowerCase() ?? null;
    const parser = this.#parsers.get(declaredMediaType);
    const conflict =
      sniffed !== declaredMediaType &&
      !(declaredMediaType === 'text/html' && sniffed === 'text/plain');
    const supported = parser !== undefined && !conflict;
    const reasonCode = parser
      ? conflict
        ? 'declared_and_sniffed_media_conflict'
        : 'registered_parser_selected'
      : declaredMediaType === 'application/pdf' || sniffed === 'application/pdf'
        ? 'pdf_explicitly_unsupported'
        : 'no_registered_parser';
    const decision = MediaSupportDecisionSchema.parse({
      schemaVersion: '1.0.0',
      contractFamily: 'p9.v1',
      decisionId:
        options.decisionId ?? `media:${bytesDigest(bytes).slice(7, 23)}`,
      declaredMediaType,
      sniffedMediaType: sniffed,
      fileExtension: extension,
      status: supported ? 'supported' : conflict ? 'ambiguous' : 'unsupported',
      parserId: supported ? parser.descriptor.id : null,
      parserVersion: supported ? parser.descriptor.version : null,
      parserDigest: supported ? parserDigest(parser.descriptor) : null,
      policyId: options.policyId ?? 'p9-media-support/v1',
      reasonCode,
      decidedAt,
    });
    if (!supported) {
      throw new ParserPolicyError(
        reasonCode === 'pdf_explicitly_unsupported'
          ? 'PARSER_UNSUPPORTED_PDF'
          : conflict
            ? 'PARSER_MEDIA_TYPE_CONFLICT'
            : `NO_PARSER:${declaredMediaType}`,
        decision,
        null,
      );
    }
    const descriptor = parser.descriptor;
    const startedAt = now().toISOString();
    const finish = (
      status: ParserReceipt['status'],
      output: string | null,
      failureCode: string | null,
    ): ParserReceipt =>
      ParserReceiptSchema.parse({
        schemaVersion: '1.0.0',
        contractFamily: 'p9.v1',
        receiptId:
          options.receiptId ?? `parser:${bytesDigest(bytes).slice(7, 23)}`,
        decisionId: decision.decisionId,
        inputDigest: bytesDigest(bytes),
        parserId: descriptor.id,
        parserVersion: descriptor.version,
        parserDigest: parserDigest(descriptor),
        mediaType: declaredMediaType,
        limits: descriptor.limits,
        status,
        outputDigest:
          output === null
            ? null
            : bytesDigest(new TextEncoder().encode(output)),
        outputCharacters: output?.length ?? 0,
        locatorCoordinateSpace:
          status === 'parsed' ? descriptor.locatorCoordinateSpace : null,
        failureCode,
        startedAt,
        finishedAt: now().toISOString(),
      });
    if (bytes.byteLength > descriptor.limits.maximumInputBytes) {
      const receipt = finish('rejected', null, 'parser_input_limit_exceeded');
      throw new ParserPolicyError(
        'PARSER_INPUT_LIMIT_EXCEEDED',
        decision,
        receipt,
      );
    }
    const started = performance.now();
    try {
      const output = parser.parse(bytes, declaredMediaType);
      if (performance.now() - started > descriptor.limits.timeoutMs) {
        const receipt = finish('timed_out', null, 'parser_timeout');
        throw new ParserPolicyError('PARSER_TIMEOUT', decision, receipt);
      }
      if (output.length > descriptor.limits.maximumOutputCharacters) {
        const receipt = finish(
          'rejected',
          null,
          'parser_output_limit_exceeded',
        );
        throw new ParserPolicyError(
          'PARSER_OUTPUT_LIMIT_EXCEEDED',
          decision,
          receipt,
        );
      }
      const boundedWorkingSet = bytes.byteLength * 4 + output.length * 2;
      if (boundedWorkingSet > descriptor.limits.maximumMemoryBytes) {
        const receipt = finish(
          'rejected',
          null,
          'parser_memory_bound_exceeded',
        );
        throw new ParserPolicyError(
          'PARSER_MEMORY_BOUND_EXCEEDED',
          decision,
          receipt,
        );
      }
      const receipt = finish('parsed', output, null);
      return {
        parserId: descriptor.id,
        parserVersion: descriptor.version,
        mediaType: declaredMediaType,
        text: output,
        mediaSupportDecision: decision,
        parserReceipt: receipt,
      };
    } catch (error: unknown) {
      if (error instanceof ParserPolicyError) throw error;
      const receipt = finish('failed', null, 'parser_malformed_input');
      throw new ParserPolicyError(
        'PARSER_MALFORMED_INPUT',
        decision,
        receipt,
        error,
      );
    }
  }
}

const defaultRegistry = new BoundedParserRegistry();

export function parseSource(
  bytes: Uint8Array,
  mediaType: string,
): ParsedArtifact {
  return defaultRegistry.parse(bytes, mediaType);
}
