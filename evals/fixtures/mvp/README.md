# Deterministic MVP research fixture

This directory is a network-free public-source fixture for the M2 runtime E2E
test. `fixture.json` is the consumer entry point and `fixture.schema.json` is its
strict, versioned contract. Paths in the manifest are relative to this directory.

The checked-in snapshot is a short excerpt of RFC 2606 section 3, attributed to
the IETF source URI in the manifest. It is immutable test input rather than a live
web response. Its byte length and SHA-256 digest are pinned. For `text/plain`, the
parsed text is byte-for-byte identical, so the parsed-text digest is also pinned.

Locators use UTF-8-decoded JavaScript string offsets with an exclusive
`endOffset`, plus one-based inclusive line numbers. The verifier requires the
offset slice and selected lines to both equal `exactText`.

The expected result deliberately includes:

- one supported claim with direct, locator-specific evidence; and
- one unresolved claim with no evidence, which must not render as a supported
  report fact.

Run `pnpm --filter @mammoth/mvp-fixture test` to validate the contract, source
bytes, locators, references, and fail-closed expected outcome.
