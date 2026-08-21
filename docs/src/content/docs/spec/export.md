---
title: Export
description: Spec card — HAR, OpenTelemetry (JSON + live OTLP push), Postman Collection, cURL, code-snippet, agent-context, session, and repro-bundle export formats.
---

## What it does

Core ships format converters that turn captured `NetworkRequest[]`/`ContractRecord[]` into
portable artifacts: HAR 1.2 and Postman Collection v2.1 for API clients, OTel JSON (batch) and
OTLP/HTTP (live push) for observability backends, cURL/fetch/axios/HTTPie/Python snippets for
pasting into code, a compact agent-context pack for pasting into an AI coding agent, and two
versioned JSON session formats (`.hakka`, `.hakka-repro`).

## Public API

```ts
import { exportHarString, buildHar, requestToHarEntry } from 'hakka-core'
import { exportPostmanString, buildPostmanCollection, requestToPostmanItem } from 'hakka-core'
import { recordsToOtelJson } from 'hakka-core' // batch OTel JSON (spans/metricPoints/logs)
import { pushOtlp, toOtlpTraces, toOtlpMetrics, toOtlpLogs } from 'hakka-core' // live push to a collector
import { buildCurl } from 'hakka-core'
import { buildFetch, buildAxios, buildHttpie, buildPython } from 'hakka-core' // "copy as code"
import { buildMswHandlers } from 'hakka-core' // NetworkRequest[] -> a multi-handler MSW v2 module (see Mock spec)
import { toAgentContext } from 'hakka-core'
import { serializeSession, deserializeSession, SESSION_SCHEMA_VERSION } from 'hakka-core' // .hakka
import { buildReproBundle, serializeReproBundle, deserializeReproBundle, REPRO_BUNDLE_SCHEMA_VERSION } from 'hakka-core' // .hakka-repro
```

```ts
exportHarString(requests) // HAR 1.2 JSON string
exportPostmanString(requests, { name? }) // Postman Collection v2.1 JSON string
recordsToOtelJson(records, { serviceName?, serviceVersion?, scopeName?, resourceAttributes? })
pushOtlp(records, { endpoint, headers?, fetchImpl?, ...OtelExportOptions }) // Promise<OtlpPushResult>, only non-empty signals sent
buildCurl(request) // shell-safe cURL string, --compressed + -u auto-detected
serializeSession(requests, meta?) // '.hakka' JSON string
buildReproBundle(requests, options?) // { requests, mocks } — mocks derived via generateMockRules
```

## Config keys + defaults

Not part of `HakkaConfig` — export is called on-demand against a `NetworkRequest[]` snapshot.
Per-function option defaults:

| Function              | Option              | Default                                                       |
| --------------------- | ------------------- | ------------------------------------------------------------- |
| `exportPostmanString` | `name`              | `'Hakka Export'`                                              |
| `recordsToOtelJson`   | `scopeName`         | `'hakka'`                                                     |
| `toAgentContext`      | `maxRequests`       | `100`                                                         |
| `toAgentContext`      | `bodySnippetLength` | `120`                                                         |
| `toAgentContext`      | `headerAllowlist`   | `['content-type', 'authorization', 'accept', 'x-request-id']` |
| `serializeSession`    | schema version      | `SESSION_SCHEMA_VERSION = 1`                                  |
| `buildReproBundle`    | schema version      | `REPRO_BUNDLE_SCHEMA_VERSION = 1`                             |
| `buildMswHandlers`    | `exportName`        | `'handlers'`                                                  |
| `buildMswHandlers`    | `maxBodyBytes`      | `10 * 1024` (10 KB, truncates larger bodies with a comment)   |

## Platform matrix

SPEC §5 rows "HAR / OTel / cURL" (footnotes 1, 4) and "Postman export":

| Capability        | RN  | iOS | Android | Web | Mac app |
| ----------------- | --- | --- | ------- | --- | ------- |
| HAR / OTel / cURL | ●   | ●   | ●       | ●   | ◐       |
| Postman export    | ●   | ●   | ●       | ●   | —       |

RN exports HAR via the inspector share button; OTel, Postman, and per-request cURL are
available as API calls (`toCurl`, `toOtelJson`, `toPostmanCollection` from `hakka-core`) and
share-sheet buttons wired into RN's request-detail share action. cURL is shell-hardened
(single-quote escaping, `--compressed` on gzip/br/deflate, Basic-auth as `-u`) as of v1.1.

## Wire format

- HAR 1.2: `{ log: { version: '1.2', creator, entries: HarEntry[] } }`.
- Postman v2.1: `{ info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: PostmanItem[] }`.
- OTel JSON: `{ schemaVersion, otelSemconvVersion: '1.40.0', resource, scope, spans, metricPoints, logs }`.
- `.hakka` session: `{ hakkaSession: 1, exportedAt?, meta?, requests: NetworkRequest[] }`.
- `.hakka-repro` bundle: `{ version: 1, exportedAt?, meta?, requests: NetworkRequest[], mocks: ReproMockRule[] }`
  — `mocks` is derived from `requests` via `generateMockRules` (same dedup `hakka mcp`'s
  `generate_mocks` tool uses), not independently authored.

## Test anchors

- `packages/hakka-core/src/model/har.test.ts`, `packages/hakka-core/src/model/harBuild.test.ts`
- `packages/hakka-core/src/model/postman.test.ts`
- `packages/hakka-core/src/model/otel.test.ts`, `packages/hakka-core/src/model/otlp.test.ts`
- `packages/hakka-core/src/model/exportRoundtrip.test.ts`
- `packages/hakka-core/src/codegen/generators.test.ts`
- `packages/hakka-core/src/export/agentContext.test.ts`
- `packages/hakka-core/src/repro/buildReproBundle.test.ts`
- `packages/hakka-core/src/session/serialize.test.ts`
- `packages/hakka-core/src/interop/msw.test.ts`

## Evidence bundle (`buildEvidenceBundle`)

The one bundling primitive behind the AI-devtool features — `export_evidence` (hakka mcp), the
browser's "Copy as agent context" action, and `get_trace`'s sibling read paths all sit on top of
it. It assembles requests + mocks + spans + diagnosis + console into a single, size-budgeted,
explicitly-truncated bundle, and deliberately calls rather than reimplements the other primitives
on this page: `buildReproBundle` for `requests`/`mocks`, `assembleTraceTree` for the
span/request correlation tree (shared with the browser's trace waterfall), `summarizeTraceGroup`
for the badge summary, and `analyzeRequests` for the diagnose ranking.

**Scrubbed for share by default** — before any of the above runs, `requests` passes through
[share scrubbing](/spec/share-scrubbing/) (`scrub: true` unless the caller opts out), since every
consumer of this bundle hands captured bodies to an AI agent. The bundle's `redaction` field
records what ran and what it found.

**Determinism:** requests are sorted (`startTime` asc, `id` tie-break) before anything else
runs, and every truncation pass is a pure function of that sorted input — same input + same
`exportedAt` always produce a byte-identical `JSON.stringify` output.

**Console correlation is a time-window approximation, not a join key** — `LogEntry` has no
`correlationId` (spans use `traceId`/`parentId`, requests use `correlationId`, logs have
neither). An entry is kept when its timestamp falls within `[min(startTime), max(endTime)]` of
the request set, padded by `EvidenceBundleOptions.logWindowMs` on each side.

**`storage` is always `null` in v1** — no snapshot/diff model exists anywhere in `hakka-core`
(`storage/` is Hakka's own `RingBuffer`/`RetentionPolicy`, not app-level localStorage/cookie
capture). The field is real, typed, and always present so callers never have to guess whether it
was omitted.

**Truncation** runs a fixed-order sequence of passes, stopping as soon as the byte budget is met;
each pass that actually cuts something appends exactly one `EvidenceBundleTruncation`:

1. Drop verbose (non-`primary`) spans from the trace.
2. Trim the oldest console entries, keeping the most recent half.
3. Cap diagnose findings, keeping the highest-severity ones first.
4. Blank non-focal requests' bodies, keeping their metadata.
5. Drop mocks entirely.
6. Drop non-focal requests entirely from the requests list (trace bars are unaffected).
7. Last resort: hard-truncate the focal request's own body — this always keeps some signal and
   never drops it entirely.

An explicit `focusRequestId` that doesn't match any request is never allowed to propagate
silently: every pass keys off `r.id === focusRequestId` to decide "focal" vs "non-focal", so an
unmatched id would otherwise make every request non-focal and empty `requests` under budget
pressure while the bundle still claims to be "about" the missing id. Core falls back to the
sorted default and records the fallback as an explicit `focusRequestId.not-found.fallback`
truncation instead.

## Repro bundle (`buildReproBundle`)

Turns a failing request (or a filtered session slice) into a self-contained repro bundle: the
requests themselves plus the mock rules (`generateMockRules`) that replay them offline, in one
call. Three deliberate design choices, documented here so they don't get "fixed" later:

- **Core's root export owns requests+mocks only.** The repro bundle's _regression test_
  (`hakka-core/test`'s `generateTestFile`) is not built by this module — it lives under the
  package root entry (`hakka-core`), which must stay free of the `./test` subpath's code so a
  production bundle that only imports `hakka-core` never pulls test helpers in. The MCP tool
  (`generate_repro`) imports both entry points and stitches the test file onto the bundle it
  gets from `buildReproBundle`.
- **Mirrors the `.hakka` session format** (`session/serialize.ts`) in shape and versioning style
  — same `exportedAt`/`meta` free-form fields, same tolerant-parse philosophy on deserialize —
  but a distinct schema marker (`hakkaReproBundle`) and file convention (`.hakka-repro`) so the
  two, both "just JSON with an array of requests in it", are never confused for one another.
- **`mocks` is derived, not independently authored.** Reusing `generateMockRules` instead of
  reimplementing dedup/pattern-derivation here means a repro bundle's mocks always stay
  behaviorally identical to what `generate_mocks`/the mock-tab "record, then mock" flow would
  produce from the same requests — one source of truth for how traffic turns into a mock.
- **Scrubbed for share by default** (`scrub: true`) — see [Share Scrubbing](/spec/share-scrubbing/).
  Mocks are generated FROM the already-scrubbed requests, not the raw input, so a mock built from
  a repro bundle never replays a secret value. The one exception is
  `createReproBundleExporter` (the `Exporter`-contract `.hakka-repro` file save), which force-sets
  `scrub: false` to preserve its `lossy: false` byte-for-byte contractual guarantee.

## Web: hydrating the slim mirror before export

`hakka-browser`'s main-thread mirror is slim by default (`StoreConfig.slimEcho`)
— requests there are usually missing `requestBody`/`responseBody`, since the
store (running in a Web Worker) keeps the real bytes and only echoes
sizes/headers/timing/status proactively. Every export/diff call site (HAR,
Postman, OTel, cURL, session, repro-bundle, and the request-diff view) hydrates
its request set through one `getBodies` round-trip covering the whole export —
not one round-trip per request — before handing off to the format converters
on this page. Output is otherwise identical to a non-slim mirror; only what
sits duplicated in main-thread memory changes.

## Limits & non-goals

- HAR `headersSize` is always `-1` (spec-allowed "unknown") — a real byte count would need the
  raw request/status line, which capture doesn't retain.
- `.hakka`/`.hakka-repro` deserialize is tolerant (unknown/extra fields ignored) but throws on
  input missing its schema marker (`hakkaSession` / a valid `requests` array).
- Repro bundles carry requests + derived mocks only — the regression-test file itself
  (`hakka-core/test`'s `generateTestFile`) is stitched on by the MCP `generate_repro` tool, not by
  core (core cannot depend on `hakka-core/test`).
- `buildMswHandlers` is export-only here — the import direction (`parseMswHandlers`, MSW handler
  source → `MockRule[]`) is documented on the [Mock](/spec/mock/) card, since its output feeds
  `mockEngine` directly rather than another export format.
