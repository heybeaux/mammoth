# ADR 0010 — P8 first live search adapter, robots/licensing policy, and credential model

- Status: accepted (T0 baseline)
- Date: 2026-07-14
- Deciders: P8 coordinator; independent T0 reviewer
- Inputs: `docs/reviews/p8-search-provider-spike.md` (bounded non-production spike)

## Context

P8 introduces a provider-neutral search port. `P8_PLAN.md` requires an entry
ADR/spike to choose the first live adapter between a locally operated metasearch
option and a key-backed hosted provider, judged on result quality, licensing,
cost, determinism, and operability. The frozen offline fixture adapter is
mandatory for CI regardless of this choice. Search results and snippets are
discovery hints, never evidence.

## Decision

### 1. First live adapter: Brave Search API (key-backed hosted)

The first live `SearchPortV1` adapter is `brave-search/v1` against the Brave
Search Web API (`https://api.search.brave.com/res/v1/web/search`).

Rationale against the criteria (details in the spike report):

- **Licensing** — an explicit commercial API agreement permits programmatic
  querying and storage of result metadata. The locally operated metasearch
  option (SearXNG) aggregates engines whose terms generally prohibit scraping;
  shipping it as the _default_ would contradict Mammoth's recorded
  robots/licensing posture.
- **Result quality** — independent index, structured JSON (title, URL, snippet,
  page age, language), sufficient for discovery-hint use.
- **Cost** — per-request pricing with a free tier; maps 1:1 onto P8 request/
  currency budget reservations and cost receipts.
- **Determinism** — no live provider is deterministic; CI uses only the offline
  fixture adapter, and live runs record full query/result receipts.
- **Operability** — single HTTPS endpoint plus one API key; no extra container in
  the turnkey profile; trivial `doctor` preflight.

### 2. Fallback

- **Offline fixture adapter** (`fixture-search/v1`) is mandatory in CI and in the
  deterministic verifier. It never silently substitutes for a live provider: the
  active search profile is explicit configuration recorded in receipts.
- **SearXNG self-hosted metasearch** (`searxng/v1`) is the documented keyless
  fallback profile for operators who accept engine-terms responsibility. It is
  explicitly labelled operator-responsibility in configuration and receipts, is
  not packaged as a default in `mammoth up`, and is not required for the P8
  release claim.
- Missing/invalid credentials fail closed with an actionable `mammoth doctor`
  diagnostic. There is no silent downgrade between adapters.

### 3. Robots and licensing policy (acquisition layer)

- Fetch and record `robots.txt`; obey explicit machine-readable denial for the
  requesting agent by default.
- Never bypass authentication, paywalls, or CAPTCHAs.
- Record licensing/terms metadata per source (`allowed`, `denied`, `unknown`,
  `conflicting`) in the snapshot manifest; `unknown`/`conflicting` is recorded,
  not fatal, but limits published quotation length.
- Published verbatim quotations are bounded (default ≤ 60 words per source
  span; threshold frozen in `evals/fixtures/p8/thresholds.json`).
- Any allowlisted operator override is explicit, attributable, receipted, and
  cannot weaken authentication/paywall/CAPTCHA rules.

### 4. Credential and preflight model

- Credential: `MAMMOTH_SEARCH_BRAVE_API_KEY`, supplied via environment/profile
  secret store; readable only inside the executing search Activity; never in
  prompts, logs, receipts, or model-visible data.
- `mammoth doctor` preflight: validates key presence/shape, then issues one
  bounded capability query with a stable effect ID and cost receipt; failure
  yields a named fail-closed diagnostic.
- Every live search call carries a provider policy ID, program budget
  reservation, and effect receipt per ADR 0009 §3.

## Consequences

- Lane B implements `search-port` contracts plus `fixture-search/v1` and
  `brave-search/v1`; `searxng/v1` may follow later without a new ADR provided the
  port contract is unchanged.
- The mandatory T8 live exhibition requires a Brave API key and billing
  authorization; absence blocks release, not offline implementation.
- Changing the default live provider requires a new ADR and spike.
