---
title: Leak Detection
description: Spec card — the offensive half of redaction. Tells a developer their app just sent a credential or PII somewhere it should not, with the evidence that proved it.
---

## What it does

Redaction ([capture-time](/spec/redaction/)) and [share scrubbing](/spec/share-scrubbing/) hide
secrets on the way OUT of this machine. Leak detection is the other half: it tells the developer
their app already sent one somewhere it should not have. A network inspector sees every byte an
app sends and, uniquely among proxies, knows which hosts are the developer's own — that is the
product, not a generic secret scanner.

Four detectors, run over already-captured requests:

1. **Credential to a non-first-party host.** A bearer token, JWT, API key, or session cookie sent
   in a request's headers, cookies, or query string to a host outside a first-party allowlist.
2. **A PII-shaped field appearing for the first time.** A request to an endpoint that starts
   carrying an `email`/`phone`/device-id-named field its prior requests to that same endpoint
   never carried — the shape of a third-party SDK update quietly starting to exfiltrate.
3. **PII in a URL or query string.** An email address, or a strict E.164 phone number in a
   phone-named param. Worse than the same PII in a body: it lands in server access logs,
   reverse-proxy logs, and browser history verbatim.
4. **A credential in a place that gets cached.** A credential-shaped value in a GET request's
   query string (logged regardless of any cache-control the response later sends), or a response
   explicitly marked cacheable whose JSON body carries a credential-named field.

Every finding carries `evidence`: the header/param/field name and a masked preview (never the raw
value) that produced it, so a developer can judge a finding in one glance instead of trusting a
score. Confidence is two-level (`high` / `medium`) — detector 2 (a limited-sample inference) is
`medium`; the other three, which observe a structural fact rather than infer a pattern, are
`high`. Where a detector cannot be confident it stays silent rather than guess — see **Limits &
non-goals** for what is deliberately never flagged.

### The first-party allowlist default

`firstPartyHosts` is the developer's own input (hostname or glob patterns, same grammar as
`hostMatchesList`). When omitted, it is auto-inferred as the single host that received a strict
majority of the captured requests — more than every other host individually — provided the
capture has at least `minRequestsForInference` (default 3) requests. In a debugging session the
developer's own backend is overwhelmingly the busiest host; everything else (analytics SDKs, ad
networks, error reporters) is where a credential genuinely should not travel.

Neither extreme default is useful: "everything is first party" never fires, and "nothing is first
party" fires on the developer's own paginated API calls and buries every real finding in noise. A
data-driven majority host is the default that actually works without configuration. When the
capture is too small or too flat (no clear majority — including a tie) to infer confidently,
detector 1 is skipped entirely rather than guessed; `firstPartyHostsUsed` is `[]` in that case, so
a caller can render "not enough traffic to infer an allowlist yet" honestly.

## Public API

```ts
import { detectLeaks } from 'hakka-core'
```

```ts
detectLeaks(requests, options?) // LeakDetectionResult
```

```ts
interface LeakDetectionResult {
  findings: LeakFinding[]
  firstPartyHostsUsed: string[] // explicit input, the inferred majority host, or [] if neither
  fieldBaseline: FieldBaseline // thread back into the next call's `fieldBaseline` to persist it
  summary: string
}

interface LeakFinding {
  kind: 'credential-to-third-party' | 'new-pii-field' | 'pii-in-url' | 'credential-in-cacheable-place'
  confidence: 'high' | 'medium'
  message: string
  requestId: string
  url: string
  method: string
  evidence: { location: string; preview: string }[]
}
```

## Config keys + defaults

Not part of `HakkaConfig` — a pure function called on demand (MCP tool, desktop panel, CI check),
not a capture-time toggle.

| Option                   | Default                                          | Description                                                                              |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `firstPartyHosts`         | Auto-inferred majority host, or `[]` if unclear    | See **The first-party allowlist default** above.                                          |
| `minRequestsForInference` | `3`                                                | Minimum captured requests before auto-inferring a first-party host.                       |
| `fieldBaseline`           | `{}`                                               | A prior call's `fieldBaseline`, threaded back in to persist detector 2's baseline.         |
| `newFieldBaselineMin`     | `3`                                                | Prior observations of an endpoint required before "new field" detection activates for it. |
| `maxFindings`              | `50`                                               | Cap on findings returned, ranked highest confidence first.                                |

## Platform matrix

Not a distinct row in SPEC §5 — JS-only today (backs the MCP `detect_leaks` tool over
`hakka-core`'s `NetworkRequest[]`). No native (iOS/Android/RN) equivalent exists yet.

| Capability     | RN  | iOS | Android | Web |
| -------------- | --- | --- | ------- | --- |
| Leak detection | ○   | ○   | ○       | ●   |

## Test anchors

- `packages/hakka-core/src/analyze/__tests__/leakDetection.test.ts` — every detector's true
  positive and at least one near-miss that must stay silent, plus allowlist inference (majority
  host, insufficient sample, tie), field-baseline persistence across calls, and result ranking
- `packages/hakka/src/mcp/__tests__/server.test.ts` — `detect_leaks` present in the MCP tool list

## Limits & non-goals

- **Not a secret scanner**, same honesty as [share scrubbing](/spec/share-scrubbing/): pattern
  and name matching against known shapes, not a general-purpose classifier.
- **A bare digit sequence is never treated as a phone number.** Order IDs, timestamps, pagination
  cursors, and zip codes are digit sequences too; only a `+`-prefixed E.164 shape in a
  phone-named query param counts.
- **The very first request to a brand-new endpoint never triggers detector 2** — there is no
  baseline yet to compare against, and flagging the endpoint's own first shape would be pure
  noise.
- **Detector 2 only looks at PII-NAMED fields** (email/phone/device-id shapes), not "any new
  key" — most new keys are unremarkable API evolution, and a name-based filter is what keeps the
  false-positive rate low enough to trust.
- **Absence of caching headers is never treated as "cacheable."** Detector 4b requires an
  explicit positive signal (`Cache-Control: public` or a `max-age` greater than zero, without
  `no-store`) — guessing a browser's default heuristic caching behavior would be exactly the kind
  of unfounded inference this module exists to avoid.
- **An arbitrary cookie is never treated as a session credential.** Only a fixed, well-known list
  of session-cookie names (`sessionid`, `connect.sid`, `jsessionid`, …) counts; a theme
  preference or an A/B bucket cookie is not a credential.
- Body content is out of scope for detector 1 (credential-to-third-party) — it looks at
  transport-level exposure (headers, cookies, URL) only, since that is what a third party's own
  server logs actually record regardless of what a request body contains.
- Findings never include the raw secret value — only a masked preview (`abcd…yz (42 chars)`) —
  so a leak-detection result is itself safe to hand to an agent or paste into a bug report.
