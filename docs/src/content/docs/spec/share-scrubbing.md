---
title: Share Scrubbing
description: Spec card — the share-time secret-scrubbing pass applied by default to MCP read tools, repro/evidence bundles, and the browser's Copy-as-agent-context action.
---

## What it does

Share scrubbing is a SECOND, independent redaction pass from [capture-time body
redaction](/spec/redaction/). Capture-time redaction is what the developer told the SDK to hide
from the record entirely — by the time a request reaches this module, that data is already gone.
Share scrubbing is about what is allowed to leave THIS machine inside one particular artifact: an
MCP tool result, a `.hakka-repro` bundle, an evidence bundle, or the clipboard payload behind
"Copy as agent context." A developer debugging locally wants to see the token in the inspector;
the bug report or agent thread must not contain it. The two passes deliberately do NOT share a
field-name list — share scrubbing's list is broader and is Hakka's own opinion of "never leaves
the machine by default," not the developer's capture-time configuration.

It catches, beyond a configurable JSON-field-name list: bearer tokens and JWTs anywhere in a body
(not just inside a header), API keys and other named secrets in query strings, Basic-auth
credentials embedded in a URL, sensitive headers (reusing `DEFAULT_SENSITIVE_HEADERS`), and email
addresses (the one pattern with a real false-positive risk, so it stays opt-out-able). It is
pattern matching, not a secret scanner — see **Limits & non-goals** below for what it does not
catch, and never rely on it as the only line of defense for a genuinely sensitive artifact.

Bias: a missed secret is a leak; an over-scrubbed body is only an annoyance. Every pattern here is
tuned toward catching more, not toward precision.

### Defaults, by surface

Anything that hands a captured body to an agent or across a machine boundary defaults to
scrubbed; the developer opts OUT explicitly.

| Surface                                                                        | Default                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP `get_request` / `list_requests` / `search_requests`                        | Scrubbed                                    | Read tools hand request data straight into agent context — the same case the strong local-first prior covers. `unredacted: true` opts out per call.                                                                                                                                                                                                                                                             |
| MCP `export_evidence`                                                          | Scrubbed                                    | Built specifically to hand a failure to an agent. `unredacted: true` opts out.                                                                                                                                                                                                                                                                                                                                  |
| MCP `generate_repro`                                                           | Scrubbed, including the generated test file | A repro bundle exists to leave the machine (handed to someone else, filed as a bug). The generated test file is built from the SAME scrubbed requests as the bundle — building it from the raw pool would silently undo the bundle's own scrub for the one artifact most likely to bake a literal secret value into an assertion string. `unredacted: true` opts out.                                           |
| Browser "Copy as agent context" (`copyAgentContextForRequest`)                 | Scrubbed                                    | The clipboard payload is about to be pasted into an AI agent thread. Pass `{ scrub: false }` to opt out for one copy.                                                                                                                                                                                                                                                                                           |
| `createReproBundleExporter` (the `Exporter`-contract `.hakka-repro` file save) | NOT scrubbed (forced off)                   | This wrapper is the ONE contractually byte-for-byte-lossless (`lossy: false`) exporter — `exporterConformance.ts` checks that claim. Scrubbing is itself a lossy transform, so this wrapper force-sets `scrub: false` regardless of what its options request. A caller wanting a scrubbed `.hakka-repro` file calls `buildReproBundle` + `serializeReproBundle` directly instead of going through this wrapper. |
| HAR / OTel export (`exportHarString`, `recordsToOtelJson`)                     | NOT scrubbed                                | Out of this pass's scope — see **Limits & non-goals**.                                                                                                                                                                                                                                                                                                                                                          |

## Public API

```ts
import {
  scrubNetworkRequestForShare,
  scrubRequestsForShare,
  scrubUrlForShare,
  scrubHeadersForShare,
  scrubBodyForShare,
  describeShareScrub,
  DEFAULT_SHARE_SCRUB_JSON_FIELDS,
  DEFAULT_SHARE_SCRUB_QUERY_PARAMS,
  DEFAULT_SHARE_SCRUB_HEADERS,
} from 'hakka-core'
import { buildReproBundle } from 'hakka-core' // repro/buildReproBundle.ts — { scrub?, scrubOptions? }
import { buildEvidenceBundle } from 'hakka-core' // repro/buildEvidenceBundle.ts — { scrub?, scrubOptions? }
```

```ts
scrubNetworkRequestForShare(request, options?) // { request: NetworkRequest, removed: ShareScrubRemoval[] }
scrubRequestsForShare(requests, options?) // { requests: NetworkRequest[], removed: ShareScrubRemoval[] } — merged tally
scrubUrlForShare(url, options?) // { url: string, removed: ShareScrubRemoval[] } — Basic auth + query params
scrubHeadersForShare(headers, options?) // { headers, removed: ShareScrubRemoval[] }
scrubBodyForShare(body, options?) // { body, removed: ShareScrubRemoval[] } — JSON field scrub + pattern scan
describeShareScrub(summary) // human-readable one-liner, e.g. "Scrubbed before sharing: 2 headers, 1 JSON field."
```

## Config keys + defaults

Not part of `HakkaConfig` — share scrubbing is applied on demand by the surfaces listed above,
each with its own default (see the table above), not a global toggle.

| Function                        | Option                                                  | Default                                                    |
| ------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `buildReproBundle`              | `scrub`                                                 | `true`                                                     |
| `buildEvidenceBundle`           | `scrub`                                                 | `true`                                                     |
| every `scrub*ForShare` function | `scrubEmails`                                           | `true`                                                     |
| every `scrub*ForShare` function | `extraJsonFields` / `extraQueryParams` / `extraHeaders` | `[]` — additive to the defaults below, never a replacement |

`DEFAULT_SHARE_SCRUB_JSON_FIELDS` covers common credential/PII field names (`password`, `token`,
`secret`, `apiKey`, `authorization`, `ssn`, `creditCard`, `session`, and their common variants).
`DEFAULT_SHARE_SCRUB_QUERY_PARAMS` covers the query-string equivalents (`key`, `token`,
`api_key`, `session`, …). `DEFAULT_SHARE_SCRUB_HEADERS` is `DEFAULT_SENSITIVE_HEADERS` — the same
list capture-time redaction uses as its own default, since a header sensitive enough to redact at
capture is at least as sensitive at share time.

## Platform matrix

Not a distinct row in SPEC §5 — JS-only today (Node/MCP + Web). No native (iOS/Android/RN)
equivalent exists yet; each of those platforms' own share/export paths still needs the same
share-time pass, tracked as follow-up work rather than claimed here.

| Capability      | RN  | iOS | Android | Web |
| --------------- | --- | --- | ------- | --- |
| Share scrubbing | ○   | ○   | ○       | ●   |

## Wire format

`ReproBundle` and `EvidenceBundle` both carry a `redaction: { applied: boolean, removed:
ShareScrubRemoval[] }` field — `applied: false` only when the caller explicitly opted out,
`removed: []` when the pass ran and found nothing. This is never silent: a recipient must be able
to tell "scrubbed and clean" apart from "never scrubbed at all." `.hakka-repro` files round-trip
`redaction` when present; a file written before this field existed deserializes with
`redaction: undefined` — treat that as "unknown," never as "confirmed clean."

Every MCP read/export tool embeds the same `redaction` shape in its JSON result. The browser's
"Copy as agent context" clipboard payload states it in the preamble text (via
`describeShareScrub`), since a human skimming the paste before the fenced JSON block is the
actual audience there, not only an agent parsing structured data.

## Test anchors

- `packages/hakka-core/src/utils/__tests__/shareScrub.test.ts` — the scrub primitives, including
  a secret placed in a header, JSON body field, query string, and nested body object
- `packages/hakka-core/src/repro/__tests__/buildReproBundle.test.ts` — default-on scrub, mocks
  derived from scrubbed data, `scrub: false` opt-out, `createReproBundleExporter` staying
  byte-for-byte lossless
- `packages/hakka-core/src/repro/__tests__/buildEvidenceBundle.test.ts` — default-on scrub
  applied before trace/diagnosis/mocks are derived
- `packages/hakka-core/src/export/__tests__/agentEvidence.test.ts` — the preamble's visible scrub
  notice
- `packages/hakka/src/mcp/__tests__/evidenceScrubbing.test.ts` — all five MCP surfaces
  (`get_request`, `list_requests`, `search_requests`, `export_evidence`, `generate_repro`)
  through the real MCP protocol, including the `generate_repro` test-file leak this pass closed
- `packages/hakka-browser/src/ui/__tests__/agentEvidenceAction.test.ts` — the clipboard action

## Limits & non-goals

- **Not a secret scanner.** This is pattern matching against known shapes (JWTs, `Bearer`
  tokens, named JSON fields, named query params, Basic-auth URLs, sensitive headers, email
  addresses). It will NOT catch a bespoke token format, a secret embedded in free-form prose with
  no recognizable shape, or a secret split across two fields.
- **HAR and OTel export are out of scope for this pass.** `exportHarString`/`buildHar` and
  `recordsToOtelJson`/`pushOtlp` do not apply share scrubbing — they remain byte-faithful to
  whatever capture-time redaction already produced. Flagged as a known gap, not silently
  implied-safe: a HAR or OTel export can carry the same secrets an unscrubbed MCP call would.
- **`createReproBundleExporter` is deliberately excluded** (see the defaults table above) to
  preserve its `lossy: false` contractual guarantee.
- **Spans are not scrubbed.** `export_evidence`'s `spans` (framework spans from `SpanStore`) pass
  through unmodified — framework spans carry names/attributes, not raw HTTP bodies, so this is a
  lower-risk gap than the request/response path, but it is still unaudited.
- JSON body field matching is exact-name (case-insensitive), same limitation as capture-time body
  redaction — no glob/regex support there.
- Nesting is bounded to depth 100, matching capture-time redaction's guard against pathological
  input.
