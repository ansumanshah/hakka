---
title: Mock
description: Spec card — intercept requests by URL/method pattern to serve canned responses, block, redirect (Map Remote), or rewrite in-flight traffic.
---

## What it does

`MockEngine` matches captured requests against an ordered rule list (first enabled match wins)
and applies one of five modes: serve a canned response (`mock`), abort with a network error
(`block`), simulate a specific transport-level failure (`failure` — e.g. timeout, no
connection, TLS failure; the request never gets a real response, and the mocked error is more
precise than `block`'s generic one), send the real request to a different URL (`redirectTo`, Map
Remote), or transform the real request/response in flight — either declaratively (`modify`:
header/query/status/body-text edits, no function required) or via `rewrite` mode's
`rewriteRequest`/`rewriteResponse` callbacks. Precedence when several are set on one rule:
`failure` > `block` > rewrite path (`redirectTo`/`modify`) > plain mock `response`. Rules are
matched in the `fetch`/XHR interceptor before the real network call.

A rule can also carry `skipCount`/`stopAfter` to gate _whether_ a match applies at all, on top of
_what_ it does: `skipCount` serves the real response for the first N matches before the rule
starts applying (mirrors testing "the third call of a retry sequence" or "the refresh, not the
first load"), and `stopAfter` applies the rule N times then reverts to real traffic forever. The
counter is **device-side, in-memory engine state** — it counts every match (including the ones
skipped), lives for the process's lifetime, and resets on relaunch or whenever the rule is
re-added/edited (a fresh rule as far as the engine is concerned). It is not persisted and not
reported back over the control channel, so a remote driver (the desktop app, `hakka mcp`) can
configure the budget but cannot observe live progress through it — see Wire format below.

## Public API

```ts
import { mockEngine } from 'hakka-core'
import type { MockRule, MockRuleInput, MockResponse, MockRequestContext, MockResponseContext } from 'hakka-core'

const id = mockEngine.addRule(ruleInput) // caller-supplied id replaces in place; auto-generated otherwise
mockEngine.removeRule(id)
mockEngine.enableRule(id)
mockEngine.disableRule(id)
mockEngine.getRules() // MockRule[] (shallow copy)
mockEngine.clearRules()
mockEngine.serialize() // JSON string; functions (bodyProvider/rewriteRequest/rewriteResponse) are dropped
mockEngine.deserialize(json)
mockEngine.registerNativeBridge(bridge) // mirror mock/block rules to a native layer (RN)
```

```ts
interface MockRule {
  id: string
  pattern: string | RegExp
  method?: string
  mode?: 'mock' | 'rewrite'
  rewriteRequest?: (req: MockRequestContext) => MockRequestContext | Promise<MockRequestContext>
  rewriteResponse?: (
    res: MockResponseContext,
    req: MockRequestContext,
  ) => MockResponseContext | Promise<MockResponseContext>
  redirectTo?: string
  modify?: MockRuleModify // declarative edits; triggers the rewrite path on its own, no mode:'rewrite' needed
  block?: boolean
  failure?: MockFailure // transport-level failure instead of any response; takes priority over block
  skipCount?: number // serve the real response for this many initial matches before applying (default 0)
  stopAfter?: number // apply this many times (after skipCount), then stop forever (default: unlimited)
  response: MockResponse // { status, headers?, headerValues?, body: string | object, delay?, bodyProvider? }
  enabled: boolean
  hitCount: number
}

// Platform-neutral transport-error vocabulary — see the cross-runtime mapping table
// (URLError.Code on iOS, IOException subtypes on Android) in MockEngine.ts's own doc comment.
interface MockFailure {
  code:
    | 'timeout'
    | 'noConnection'
    | 'cannotFindHost'
    | 'cannotConnectToHost'
    | 'connectionLost'
    | 'secureConnectionFailed'
    | 'cancelled'
    | 'unknown'
}

// Plain data (no functions) — serializable, and drivable over the control channel.
interface MockRuleModify {
  setRequestHeaders?: Record<string, string>
  removeRequestHeaders?: string[]
  setQueryParams?: Record<string, string>
  removeQueryParams?: string[]
  status?: number // override the real response's status code
  setResponseHeaders?: Record<string, string>
  removeResponseHeaders?: string[]
  replaceBody?: Array<{ find: string; replace: string }> // plain-string find/replace, in order — no regex
}
```

MSW (Mock Service Worker v2) interop round-trips `MockRule[]` against MSW handler source —
export existing rules/requests to a handlers module, or import an existing MSW setup as rules:

```ts
import { buildMswHandlers, parseMswHandlers } from 'hakka-core'
import type { BuildMswHandlersOptions, ParseMswHandlersResult, UnsupportedMswHandler } from 'hakka-core'

buildMswHandlers(requests, { exportName?, maxBodyBytes? }) // NetworkRequest[] → TS source string
parseMswHandlers(source) // TS source → { rules: MockRule[], unsupported: UnsupportedMswHandler[] }
```

`parseMswHandlers` is static analysis only (a bracket-balancing scanner, no TS compiler) over a
narrow, literal subset of MSW's `http.<method>(...)` shape — anything outside that subset
(dynamic resolver, non-literal path/body, `RequestHandlerOptions`) is reported per-handler in
`unsupported` rather than silently dropped.

## Config keys + defaults

Not part of `HakkaConfig` — rules are added imperatively via `mockEngine.addRule()`. There is no
global mock on/off flag; an empty rule list is a no-op.

## Platform matrix

SPEC §5 row "Mocking / throttle" (footnotes 5, 6):

| Capability         | RN  | iOS | Android | Web | Mac app |
| ------------------ | --- | --- | ------- | --- | ------- |
| Mocking / throttle | ●   | ●   | ●       | ●   | ●       |

iOS: mock rules (block / canned response / redirectTo / declarative `modify` / transport-error
`failure`, per-rule delay, `skipCount`/`stopAfter` match budget). `redirectTo`/`modify` route the
match through `HakkaURLProtocol`'s passthrough-then-transform path — a real request goes out
(URL/headers/query rewritten first), then the real response's status/headers/body are
transformed before delivery (`Common/MockRuleModify.swift`'s `MockRuleTransform`); `block`
short-circuits with a network-error-shaped failure (`NSURLErrorNotConnectedToInternet`,
`error: "Blocked by Hakka"`); `failure` short-circuits with the specific `URLError.Code` its
`MockFailureCode` declares (`Common/MockFailure.swift`) — both are still recorded.
`skipCount`/`stopAfter` gate whether a match applies at all, evaluated in
`MockEngineMatching.swift`'s `admitMatchLocked` before any of the above run. Android: same shape
via `HakkaInterceptor.interceptRewrite` — `chain.proceed` on the rewritten `okhttp3.Request`,
then a `response.newBuilder()` re-wrap for status/header/body edits (`MockEngine.kt`'s
`MockRuleTransform`); `block` throws `IOException("Blocked by Hakka")`; `failure` throws the
specific `IOException` subtype its `MockFailureCode` maps to (`ioExceptionForFailure` in
`HakkaInterceptor.kt`) before any real request is sent; `skipCount`/`stopAfter` gate via
`MockEngine.kt`'s in-memory `matchCounts`, same semantics as iOS. Neither native platform has
`mode`/`rewriteRequest`/`rewriteResponse` functions (those cannot cross a native bridge) — a
native rule is routed through the rewrite/transform path purely because it declares `redirectTo`
and/or `modify` (`MockRule.isRewrite`). On RN, `MockEngine` mirrors `mock`/`block`/`failure`
rules and `skipCount`/`stopAfter` to native via `NativeMockBridge`
(`NativeMockRulePayload`/`toNativeRule`); `redirectTo`/`modify` are JS-only today — the native
payload does not yet carry those fields, so a JS-authored `redirectTo`/`modify` rule applies in
the RN JS interceptor but is not mirrored to the native iOS/Android engines (JS state remains
authoritative; this is a known gap, not a semantic difference — native engines fully support
`redirectTo`/`modify` when driven directly, e.g. over the control channel). RN's own vendored
native mock engine (used for OkHttp/native traffic outside the JS interceptor,
`packages/hakka-react-native/android/.../HakkaMockEngine.kt` and the iOS bridge in
`RNHakkaCoreBridge.swift`) independently implements the same `failure`/`skipCount`/`stopAfter`
gating so parity holds on that path too.

## Wire format

Driven remotely over the [bridge control channel](/spec/control-channel/) as a `mock.add` /
`mock.remove` / `mock.clear` `ControlCommand` — identical `kind`/field shape on every platform
(`control.ts` / iOS `ControlCommand.swift` / Android `ControlCommand.kt`), including `redirectTo`,
`block`, `modify`, `failure: { code }`, and `skipCount`/`stopAfter` (non-negative integers,
absent/`0`/`null` meaning "not set"). Pinned wire fixtures for these shapes live in
`fixtures/control/mock-add-failure.json`, `fixtures/control/mock-add-skip-stop.json`, and
`fixtures/control/mock-add-header-values.json`, read by every runtime's tests.

`response.headers` is `{ name: value }` — one representative value per header name. A header that
legitimately carries more than one value on the wire — chiefly `Set-Cookie`, where RFC 6265 §3
forbids folding multiple values into one comma-joined field (a cookie's own `Expires` attribute can
legally contain a comma, so a naive join is ambiguous/corrupt) — is additionally carried in
`response.headerValues: { name: string[] }`. This is purely additive: `headers` still has an entry
for every header name including ones also present in `headerValues`, so a decoder that only reads
`headers` behaves exactly as before. Every runtime applies `headerValues` using its own real
multi-header mechanism where one exists (`Headers.append` on web, OkHttp's repeated-header support
on Android) rather than a join; iOS's `HTTPURLResponse(headerFields:)` has no such API (Apple
platforms cap the public initializer at one value per header name — see
`MockResponse.httpHeaderFields`'s doc in `ios/Sources/Common/MockRuleTypes.swift`), so it joins with
`", "` there — verified safe specifically for `Set-Cookie` because `HTTPCookie.cookies
(withResponseHeaderFields:for:)`, the API `URLSession` itself uses to populate the cookie jar,
correctly reconstructs distinct cookies from that join even when one has a comma inside its own
`Expires` attribute. `apps/hakka`'s `CapturedMockConverter` (capture -> mock promotion) is the one
place today that actually produces a multi-value `headerValues` entry, for captured responses with
more than one `Set-Cookie` value.

On the TS engine, a matched-and-applied rule marks the captured record
`mocked: true` (mock mode) or `rewritten: true` (rewrite/redirect mode). iOS and Android capture
records have no `rewritten` flag (a smaller field set than the TS `NetworkRequest`) — a
redirectTo/modify match is recorded like a normal request (real URL/headers/status/body,
`source: urlSession`/`OKHTTP`), a `block` match is recorded with `error: "Blocked by Hakka"` and
`status: null`, and a `failure` match is recorded with `error: <MockFailureCode's message>` and
`status: null`.

**What the desktop app cannot show.** `skipCount`/`stopAfter` progress is device-side, in-memory
engine state, and the control channel is fire-and-forget with no feedback frame (see the [control
channel spec](/spec/control-channel/)) — so a host driving a rule remotely (the desktop app,
`hakka mcp`) can configure the budget but never learn how far a device has progressed through it.
The desktop's `RuleEntryDisplay` shows the _configured_ numbers ("skip 2 · stop after 5") as a
static suffix, never a live counter; `RuleEntry.hitCount` on the desktop is a separately-computed
local count of matches the desktop itself has observed in captured traffic, not a value read back
from the device. Only an on-device inspector (iOS's `MocksView`, Android's `MocksPanel`) reads the
same engine instance that owns the counter, so only those surfaces can show it live — and even
they only show `hitCount` (applied matches), not the raw skip-consuming match count.

## Record-then-mock (`generateMockRules`)

`generateMockRules(requests, options?)` (`packages/hakka-core/src/engine/mockFromTraffic.ts`) turns
already-captured `NetworkRequest`s into `MockRuleInput` rules in one pass — the engine behind the
MCP `generate_mocks` tool. Three deliberate design choices:

- **Dedup key is `(method, path+query)`** — one rule per unique endpoint shape. When the same
  endpoint was hit more than once, the newest capture wins (by `startTime`, ties broken by later
  array position) — that's usually the most representative shape of the API.
- **Pattern is path+query only, origin stripped.** A mock keyed to a specific host would stop
  matching the moment the app points at a different host (staging/prod/tunnel) — defeating
  "record once, mock everywhere."
- **Requests with no usable response are skipped** — a pending request (no `status`, no
  `responseBody`) or an errored request with no status has nothing meaningful to replay.

## Test anchors

- `packages/hakka-core/src/engine/MockEngine.test.ts`
- `packages/hakka-core/src/engine/mockFromTraffic.test.ts`
- `packages/hakka-core/src/capture/rewrite.test.ts`
- `packages/hakka-core/src/capture/xhr.test.ts`
- `packages/hakka-core/src/capture/mockSkipStopFailure.test.ts`
- `packages/hakka-core/src/interop/msw.test.ts`
- iOS: `ios/Tests/HakkaTests/MockEngineTests.swift`, `MockEngineSkipStopFailureTests.swift`,
  `MockRuleModifyTests.swift`, `URLProtocolRewriteTests.swift`, `ControlCommandTests.swift`,
  `ControlCommandMockSkipStopFailureTests.swift`
- Android: `android/hakka-network/src/test/kotlin/com/noodleapps/hakka/MockEngineTest.kt`,
  `MockEngineSkipStopFailureTest.kt`, `MockRuleTransformTest.kt`, `HakkaInterceptorTest.kt`,
  `HakkaInterceptorFailureTest.kt`, `ControlCommandTest.kt`, `ControlCommandMockSkipStopFailureTest.kt`
- Desktop: `apps/hakka/Tests/CoreTests/ControlCommandEncoderTests.swift`,
  `RuleEntryDisplayTests.swift`

## Limits & non-goals

- `rewrite`, `redirectTo`, and `modify` (which all flow through the same rewrite path) execute
  only in the `fetch` interceptor. XHR supports `mock` and `block`; a rule matched by XHR that
  would otherwise rewrite passes through untransformed by design — XHR cannot substitute a
  response body.
- `bodyProvider` / `rewriteRequest` / `rewriteResponse` are functions and cannot survive
  `serialize()`/JSON persistence — reload requires re-registering them in code. `modify` is plain
  data and survives serialization intact.
- `modify.replaceBody` is plain-string find/replace only — no regex, by design (a rule set
  imported from JSON must not carry unpredictable-backtracking-cost RegExp objects).
- Mock delay is capped at 30 seconds regardless of the configured `delay`.
- `parseMswHandlers` only recognizes one emitted shape (single-statement arrow-function
  resolvers) — hand-written MSW handlers using a block body or non-literal values fall into
  `unsupported` rather than converting.
- `skipCount`/`stopAfter` counting is **per rule, per engine instance** — a match increments the
  same counter regardless of which mode (`mock`/`block`/`failure`/rewrite) it would apply, and the
  counter is not shared across devices or processes. Editing or re-adding a rule with the same id
  restarts its budget from zero; it does not resume where the previous version left off.
- No feedback frame reports `skipCount`/`stopAfter` progress back to a remote host — see "What
  the desktop app cannot show" above. Building one is out of scope for this iteration.
- `failure` and `block` are not composable — a rule with both set behaves as `failure` only
  (`block` is silently shadowed, not an error).
