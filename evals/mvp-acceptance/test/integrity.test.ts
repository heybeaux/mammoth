import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalDigest, canonicalJson } from '../src/integrity.js';

void test('independent canonicalization is stable and key-order insensitive', () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, x: 3 } }),
    '{"a":{"x":3,"y":2},"z":1}',
  );
  assert.equal(
    canonicalDigest({ b: 2, a: 1 }),
    canonicalDigest({ a: 1, b: 2 }),
  );
});
