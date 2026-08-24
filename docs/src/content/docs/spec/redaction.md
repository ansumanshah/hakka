---
title: Redaction
description: Spec card — header-value redaction/stripping and JSON body field redaction applied before a request is stored.
---

## What it does

Redaction replaces sensitive header values and JSON body field values with `[REDACTED]` before
a captured request reaches the ring buffer or any sink — the key/field name is preserved, only
the value is blanked. Header matching supports exact names, glob (`x-*-token`), and regex
patterns; body redaction matches exact (case-insensitive) JSON key names, recursively, up to a
bounded depth.

Body redaction runs at every capture chokepoint, not just `fetch`: `fetch`, XHR, `sendBeacon`,
Node's `http`/`https` interceptor, and WebSocket **text** frames. It runs inside the synchronous
capture path, so a redacted value is the only version that ever reaches the wire — see
[ADR 0004 (e)](/contributing/adr/0004-remote-sessions/).

React Native's **monitors** apply it too, on their own channels:

- `useAsyncStorageMonitor` / `useMMKVMonitor` match the storage _key_ by substring rather than
  exact name, because real keys are namespaced (`@myapp:auth_token` matches a configured `token`),
  and blank the whole value on a hit. A value that doesn't match by key still goes through JSON
  field redaction.
- `useQueryMonitor` / `useReactQueryDevTools` redact the cached payload. A react-query cache holds
  whole API responses, so it carries what the interceptors already redact — but this monitor emits
  the parsed object separately. An unserializable entry is dropped rather than emitted raw.

Storage is where credentials are persisted rather than merely transit, so these paths are worth
configuring even if you skip the others.

## Public API

```ts
import { redactHeaders, stripHeaders, isSensitiveHeader, DEFAULT_SENSITIVE_HEADERS } from 'hakka-core'
import { configureBodyRedaction, getBodyRedactionFields, redactJsonBody } from 'hakka-core'

redactHeaders(headers, sensitiveHeaders?) // Record<string,string> — values → '[REDACTED]'
stripHeaders(headers, sensitiveHeaders?) // Record<string,string> — matching keys removed entirely
isSensitiveHeader(name, sensitiveHeaders?) // boolean

configureBodyRedaction(fields) // sets the module-level active field list; [] disables (zero overhead)
getBodyRedactionFields() // string[] (lowercased)
redactJsonBody(body, fields?) // string | null — non-JSON bodies pass through unchanged
```

## Config keys + defaults

`redactHeaders` is part of `HakkaConfig` / `DEFAULT_CONFIG`; body-field redaction is configured
separately (not a `HakkaConfig` key) via `configureBodyRedaction()`.

| Key                                                  | Default                                                                                                                                                                                                                                                                                                           | Description                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `redactHeaders` (`HakkaConfig`)                      | `['authorization', 'proxy-authorization', 'cookie', 'set-cookie']`                                                                                                                                                                                                                                                | Header names redacted on every captured request.                                                                                      |
| `DEFAULT_SENSITIVE_HEADERS` (util constant, broader) | `authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `x-auth-token`, `x-access-token`, `x-csrf-token`, `proxy-authorization`, `www-authenticate`, `x-token`, `token`, `x-secret`, `x-session-token`, `x-amz-security-token`, `private-token`, `x-client-secret`, `session`, `x-*-token`, `x-*-secret` | Used by `redactHeaders`/`stripHeaders`/`isSensitiveHeader` when no explicit list is passed — a superset of the `HakkaConfig` default. |
| Body redaction fields                                | `[]` (disabled)                                                                                                                                                                                                                                                                                                   | Set via `configureBodyRedaction(['password', 'token', ...])`.                                                                         |

## Platform matrix

Not a distinct row in SPEC §5 — verified directly against per-platform sources rather than a
table cell:

| Capability | RN  | iOS | Android | Web | Mac app |
| ---------- | --- | --- | ------- | --- | ------- |
| Redaction  | ●   | ●   | ●       | ●   | ◐       |

iOS ships `Network/Redaction.swift`; Android ships `hakka-common/LogRedaction.kt`
(`LogRedactionTest.kt`) and `HakkaInterceptor.redactBodyFields`. All four platforms apply header
**and** JSON body-field redaction on capture. Two native differences, both deliberate:

- Native gates body redaction on a JSON content type; core-TS attempts a JSON parse regardless
  and passes non-JSON through unchanged. Same outcome, different route.
- Native also redacts sensitive **query-parameter** values (`sensitiveQueryItems`), which core-TS
  does not.

## Wire format

Redaction happens before a record is built — the value on the `NetworkRequest`/`ContractRecord`
is a literal placeholder string, and there's no separate marker distinguishing "redacted" from
"the app actually sent this string."

The placeholder differs by platform: core-TS (Web, Next.js, Node, RN JS-mode) writes
`[REDACTED]`; the iOS and Android SDKs write `██` (two U+2588 blocks, `HakkaConfig.REDACTED`).
Nothing parses it — it is read by a human — so an export carries whichever placeholder the
capturing platform used.

## Test anchors

- `packages/hakka-core/src/utils/__tests__/headerRedaction.test.ts`
- `packages/hakka-core/src/utils/__tests__/bodyRedaction.test.ts`
- `packages/hakka-node/src/__tests__/redactionBoundary.test.ts` — end-to-end ordering: a real
  request through the real interceptor and bridge client, asserting the secret is absent from the
  exact string that crosses the socket
- `packages/hakka-core/src/capture/__tests__/websocket.test.ts` (frame redaction)
- `packages/hakka-browser/src/capture/__tests__/sendBeacon.test.ts`
- `packages/hakka-react-native/__tests__/monitors/storage.test.ts` and `reactQuery.test.ts` — each
  includes a test that drives the real hook and asserts on what reaches the bridge, not just on the
  helper
- `ios/Tests/HakkaTests/HakkaInterceptorTests.swift`, `ios/Tests/HakkaTests/HakkaConfigTests.swift`
- `android/hakka-common/src/test/kotlin/com/noodleapps/hakka/LogRedactionTest.kt`

## Limits & non-goals

- Body redaction only walks parsed JSON (object/array) — non-JSON bodies (form-encoded, plain
  text, binary) are never redacted by `redactJsonBody`, and pass through unchanged.
- Matching is exact-name (case-insensitive) for body fields — no glob/regex support there, unlike
  header redaction.
- Nesting is bounded to depth 100 on every platform; a body nested deeper is left unredacted
  rather than walked. On iOS and Android the bound is checked **before** parsing, not during:
  `JSONSerialization` recurses as it parses and was measured overflowing the stack of a Swift
  concurrency task at depth 600 (safe at 400), and a stack overflow is a signal that no `try` can
  contain. Capture runs inside someone else's app, so a pathological response body must not be
  able to take it down.
- Redaction is a value replace, not encryption — `[REDACTED]` is visible proof capture happened,
  not a way to recover the original value later.
- This card covers CAPTURE-time redaction only — what the developer told the SDK to hide before a
  record is ever stored. It says nothing about what leaves the machine afterward in an MCP tool
  result, a `.hakka-repro` bundle, or an agent-context clipboard payload — see
  [Share Scrubbing](/spec/share-scrubbing/) for that second, independent pass.
