import { describe, expect, it } from 'vitest';
import { boundedP9SentenceContext } from '../src/index.js';

describe('P9 bounded sentence context', () => {
  it.each([
    ['period boundary', 'First. Next.', 0, 6, 'First.'],
    ['exclamation boundary', 'First! Next.', 0, 6, 'First!'],
    ['question boundary', 'First? Next.', 0, 6, 'First?'],
    ['newline boundary', 'First\nNext.', 0, 6, 'First'],
    ['before boundary', 'First. Next.', 0, 5, 'First.'],
    ['body start and end', 'Only sentence', 0, 13, 'Only sentence'],
    ['CRLF adjacency', 'First\r\nNext.', 0, 5, 'First'],
    ['CRLF selected', 'First\r\nNext.', 0, 7, 'First'],
  ])('%s', (_name, body, startOffset, endOffset, expected) => {
    expect(boundedP9SentenceContext(body, startOffset, endOffset)).toBe(
      expected,
    );
  });
});
