# P8 search-provider spike report (bounded, non-production)

- Date: 2026-07-14
- Author: P8 coordinator
- Purpose: input to ADR 0010; choose the first live `SearchPortV1` adapter
  between a locally operated metasearch option (SearXNG) and a key-backed hosted
  provider (Brave Search API)
- Bounds: read-only, unauthenticated, ≤ 4 HTTP requests, zero spend, no
  credentials used or created, no production code

## Method

1. Documentation review of both options against the frozen criteria: result
   quality, licensing, cost, determinism, operability.
2. Bounded live probes (3 requests total, 2026-07-14, from the coordinator
   machine):
   - `GET https://api.search.brave.com/res/v1/web/search?q=...` without a
     subscription token → HTTP 422, structured JSON error.
   - Same endpoint with an intentionally invalid token → HTTP 422 with typed
     body `{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID","detail":"The provided
subscription token is invalid.","meta":{"component":"authentication"}}}`.
   - `GET https://searx.be/search?q=...&format=json` (public SearXNG instance)
     → HTTP 403 Forbidden (JSON API disabled/blocked by the instance).

## Findings

| Criterion      | Brave Search API                                                                                                                                                       | SearXNG (self-hosted metasearch)                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result quality | Independent index; structured JSON: title, URL, snippet, page age, language; adequate for discovery hints                                                              | Aggregates upstream engines; quality varies by engine set and rate-limit health; JSON format available only when self-hosted with `format: json` enabled |
| Licensing      | Explicit commercial API terms permit programmatic query and metadata storage                                                                                           | Upstream engine terms generally prohibit scraping; public instances actively block API use (observed 403); usage responsibility falls on the operator    |
| Cost           | Free tier (order of 1 req/s, ~2000 req/month), then metered per-request pricing; maps directly to budget reservations and cost receipts                                | Free, but requires operating a container and absorbs upstream rate-limiting/blocking risk                                                                |
| Determinism    | Non-deterministic (live index)                                                                                                                                         | Non-deterministic and additionally unstable across engine availability                                                                                   |
| Operability    | One HTTPS endpoint + one header credential; typed machine-readable error codes (observed `SUBSCRIPTION_TOKEN_INVALID`) enable precise fail-closed `doctor` diagnostics | Requires packaging/operating a SearXNG container; public instances unusable programmatically (observed); engine blocks cause silent quality decay        |

Additional observations:

- Brave's typed error body means credential preflight can distinguish
  missing/invalid key from transport failure without heuristics.
- The 422-without-auth behavior confirms no anonymous access path exists; live
  exhibition requires a provisioned key and billing authorization (human gate
  before T8).
- The public-instance 403 confirms SearXNG is only viable self-hosted, which
  moves engine-terms responsibility onto the operator and adds a container to
  the turnkey profile.

## Recommendation (adopted by ADR 0010)

- First live adapter: **Brave Search API** (`brave-search/v1`).
- CI/verifier: **offline fixture adapter only**, frozen in the T0 corpus.
- Fallback: SearXNG documented as an explicit operator-responsibility
  self-hosted profile; never a silent default.

## Limitations

- No authenticated live queries were executed (no credential/billing
  authorization at T0); result-quality assessment for Brave rests on API
  documentation and the structured error/contract surface, not sampled result
  sets. The mandatory T8 live exhibition supplies the authenticated evidence.
- One public SearXNG instance was probed; other instances may behave
  differently, but that does not change the self-hosting/licensing conclusion.
- Local Docker daemon was unavailable, so no self-hosted SearXNG container was
  exercised in this spike.
