---
title: CI gate (network baseline)
description: Spec card — capturing a test suite's own network traffic, diffing it against a committed baseline, and failing the build on meaningful drift or a data-exfiltration signal.
---

## What it does

The CI gate turns network capture into a build check. A test suite records the requests it
makes via `hakka-node/ci`'s `startCiCapture`, and `hakka ci-baseline check` compares that
capture against a committed baseline file, failing the build on meaningful drift. This is not
an inspector feature — no human watches it run — it is a snapshot test for a codebase's network
contract, run by a CI job the same way it runs any other test command.

Two independent checks make up "meaningful drift":

- **Contract drift** — has the set of endpoints, their statuses, or their request body shapes
  changed since the baseline was recorded.
- **Exfiltration risk** — has a credential-shaped field been sent to a host the baseline never
  contacted, regardless of whether that host's endpoint otherwise looks fine.

## Public API

```ts
import { startCiCapture } from 'hakka-node/ci'
import {
  normalizeRequestsForBaseline,
  templatePath,
  hostOf,
  pathOf,
  shapeOfJson,
  shapeOfBody,
  DEFAULT_VOLATILE_HEADER_NAMES,
  serializeBaseline,
  parseBaseline,
  BASELINE_SCHEMA_VERSION,
  diffBaseline,
  formatDriftReport,
  findExfiltrationFindings,
  formatExfiltrationReport,
} from 'hakka-node/ci'
```

```
hakka ci-baseline record <capture.hakka> <baseline.txt>
hakka ci-baseline check  <capture.hakka> <baseline.txt> [--allow-host <host>]
```

`startCiCapture` wraps `startCapture` with CI-appropriate defaults (`bridge: false`,
`embedBridge: false`, `force: true` — no human is watching, and CI is rarely
`NODE_ENV=development`) and collects every request in memory. `.stop(outFile)` writes those
requests to a plain `.hakka` session file for the CLI to pick up — the same format
`hakka diagnose`/`hakka assert` already read, so no new raw-capture format exists.

## Normalization rules

A baseline that fails randomly gets deleted by the team in a week, so normalization is most of
the value here. Endpoints are grouped by `(method, host, templated path)`; within that key,
every call in the run contributes to a union of observed statuses, header names, and request
body shapes rather than only the first/last call — a suite that hits an endpoint twice with
different optional fields must not produce a flaky single-call snapshot.

| Rule                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port dropped from `host`                                                                                                                                                           | Local test servers bind ephemeral ports — comparing them would fail every run.                                                                                                                                                                                                     |
| Query string dropped from `path`                                                                                                                                                   | Cache-busting params and pagination cursors are not part of the contract.                                                                                                                                                                                                          |
| Numeric / UUID / ObjectId / long-opaque-token path segments templated to `:id`                                                                                                     | `/users/42` and `/users/87` are the same endpoint. Known limitation: a static segment that happens to look like an id over-templates; a dynamic slug that matches no pattern (e.g. `/posts/my-first-post`) under-templates. Both are rare enough not to need a config surface yet. |
| Request/response body VALUES never compared — only JSON _shape_ (key names + value types, recursively)                                                                             | A timestamp, nonce, or generated id inside a body must not cause drift as long as its JSON type is unchanged. A key being added/removed, or a key's type changing, IS drift.                                                                                                       |
| Header VALUES never compared — only header NAMES, minus a volatile set (`DEFAULT_VOLATILE_HEADER_NAMES`: `Date`, `X-Request-Id`, `traceparent`, `User-Agent`, `Content-Length`, …) | Auth tokens and trace ids vary every request by design; comparing them would defeat the point. A genuinely new header name is still worth surfacing (see fail/warn table below).                                                                                                   |
| Exact status codes ARE compared                                                                                                                                                    | The most direct correctness signal available — a new status on an existing endpoint is real behavior change.                                                                                                                                                                       |

## Baseline file format

Line-oriented NDJSON: a version header line, then one JSON line per endpoint, sorted by key with
a fixed field order. This is deliberate, not incidental — it is what makes the file reviewable:

- One endpoint changing touches one line in `git diff`, not the whole file.
- Fixed key order means two logically-identical baselines serialize byte-identical, so a
  re-record with no real change produces an empty diff.
- The baseline is committed and reviewed like any other file — that review IS the contract
  check, which is why `hakka ci-baseline record` never modifies it silently in CI.

## Fail vs. warn

Every drift category is a deliberate design decision. FAIL stops the build; WARN is printed but
does not block, reserved for changes that are common side effects of unrelated work and would
otherwise get this check disabled within a week.

| Finding                                         | Severity | Why                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New endpoint called                             | FAIL     | Same reasoning as a snapshot test — likely intentional, but must be captured in the baseline deliberately (re-record, review the diff) rather than start passing silently. A silently-accepted new endpoint is exactly the shape a data-exfiltration regression takes. |
| Endpoint no longer called                       | WARN     | Reduced exposure, not increased — and often incidental to an unrelated code path or feature flag. Blocking the build on "you stopped calling something" is the kind of noise that gets a check disabled.                                                               |
| New status observed on an existing endpoint     | FAIL     | The most direct correctness signal available — an endpoint that used to only 200 now also 500s is a real regression.                                                                                                                                                   |
| New request body shape on an existing endpoint  | FAIL     | The security angle, verbatim: fail the build when the app starts sending a field it never sent before. Only key names + JSON types are compared, so this never fires on a changed value, only a changed shape.                                                         |
| New request header name on an existing endpoint | WARN     | Header names churn on ordinary dependency bumps far more than they signal anything meaningful, and header VALUES are never compared — a leaked credential in a header value is exfiltration.ts's job, not this one's.                                                  |
| New host contacted anywhere in the run          | FAIL     | The strongest single security signal available — a call to a host never approved for this run is the most likely sign of an SDK/dependency exfiltrating data or a supply-chain compromise.                                                                             |

## Exfiltration check

Independent of baseline drift, `findExfiltrationFindings` scans every captured request for a
credential-shaped field or value sent to a host outside the known-hosts set (the baseline's
own hosts, widened by `--allow-host`). Two signals, both name/structure based, not entropy based:

- **Field name match** — a JSON body key, query param, or header name from
  `DEFAULT_SHARE_SCRUB_JSON_FIELDS` (the same list `hakka-core`'s share-time scrubbing already
  trusts to identify secrets — `password`, `token`, `apiKey`, `secret`, `ssn`, `creditCard`, …),
  or an `Authorization` header present at all.
- **JWT shape match** — three dot-separated base64url segments in a request body.

**False-positive story.** Deliberately NOT entropy-based: a generic "this string looks random,
therefore secret" heuristic has a bad false-positive rate against ordinary opaque ids, hashes,
and session/request identifiers that are not secrets, and would make this exact the kind of
flaky gate a team disables in a week. Name-based matching keeps the false-positive class narrow
(a field named e.g. `sessionToken` holding a non-secret value is rare, and usually still worth a
look), and JWT structure has essentially no legitimate non-secret shape. A field name match on a
host the baseline already knows about is never flagged — only a NEW host paired with a
sensitive-shaped value fails.

## Share-time scrubbing of the raw capture

The raw `.hakka` capture file `startCiCapture().stop(outFile)` writes is a share surface, not
only a local artifact — CI routinely uploads it for post-mortem debugging when a check fails,
which means it leaves the machine the same as any other export. That file goes through
`hakka-core`'s `scrubRequestsForShare` before it touches disk. The in-memory `requests` array
returned to the caller is left unscrubbed on purpose: normalize/diff run in-process and never
leave it, and a developer inspecting `capture.requests` locally is exactly the audience
share-time scrubbing is not for — see `share-scrubbing.md`'s module doc on that distinction.

## Platform matrix

Not a distinct row in SPEC §5 — this is a Node/CLI-only build-time gate, not an inspector
capability a human watches. It has nothing to do with the mobile/web capture targets SPEC §5
tracks; the "platforms" below describe where a test suite could plausibly wire `startCiCapture`
in, not inspector parity.

| Capability | RN  | iOS | Android | Web | Mac app |
| ---------- | --- | --- | ------- | --- | ------- |
| CI gate    | ⊘   | ⊘   | ⊘       | ○   | ⊘       |

**Web** is roadmap (`○`): a browser-side equivalent would need to capture from a test runner's
page context (Playwright/Cypress), not from `hakka-node`, and doesn't exist yet. **RN/iOS/Android/
Mac app** are out of scope (`⊘`) — those are native/mobile capture targets or a desktop inspector,
none of which run as a CI build step the way a Node test suite does.

## Worked example

`packages/hakka-node/examples/ci-gate/` wires a tiny HTTP server + test suite through record and
check, including a deliberately-broken second run to show a FAIL report.
