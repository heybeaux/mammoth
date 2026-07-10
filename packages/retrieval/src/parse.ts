import type { ParsedArtifact } from './types.js';

const PARSER_ID = 'mammoth-deterministic-text';
const PARSER_VERSION = '1.0.0';

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

export function parseSource(
  bytes: Uint8Array,
  mediaType: string,
): ParsedArtifact {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let text: string;
  switch (mediaType) {
    case 'text/plain':
      text = decoded.replace(/\r\n?/g, '\n');
      break;
    case 'text/html':
      text = parseHtml(decoded);
      break;
    case 'application/json':
      text = JSON.stringify(JSON.parse(decoded), null, 2);
      break;
    default:
      throw new Error(`NO_PARSER:${mediaType}`);
  }
  return {
    parserId: PARSER_ID,
    parserVersion: PARSER_VERSION,
    mediaType,
    text,
  };
}
