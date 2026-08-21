---
title: Mock
description: Spec card — intercept requests by URL/method pattern to serve canned responses, block, redirect (Map Remote), or rewrite in-flight traffic.
---

## What it does

`MockEngine` matches captured requests against an ordered rule list (first enabled match wins)
and applies one of four modes: serve a canned response (`mock`), abort with a network error
(`block`), send the real request to a different URL (`redirectTo`, Map Remote), or transform the
real request/response in flight — either declaratively (`modify`: header/query/status/body-text
edits, no function required) or via `rewrite` mode's `rewriteRequest`/`rewriteResponse`
callbacks. Rules are matched in the `fetch`/XHR interceptor before the real network call.

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
  response: MockResponse // { status, headers?, body: string | object, delay?, bodyProvider? }
  enabled: boolean
  hitCount: number
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

iOS: mock rules (block / canned response / redirectTo / declarative `modify`, per-rule delay).
`redirectTo`/`modify` route the match through `HakkaURLProtocol`'s passthrough-then-transform
path — a real request goes out (URL/headers/query rewritten first), then the real response's
status/headers/body are transformed before delivery (`Common/MockRuleModify.swift`'s
`MockRuleTransform`); `block` short-circuits with a network-error-shaped failure
(`NSURLErrorNotConnectedToInternet`, `error: "Blocked by Hakka"`) and is still recorded. Android:
same shape via `HakkaInterceptor.interceptRewrite` — `chain.proceed` on the rewritten
`okhttp3.Request`, then a `response.newBuilder()` re-wrap for status/header/body edits
(`MockEngine.kt`'s `MockRuleTransform`); `block` throws `IOException("Blocked by Hakka")` before
any real request is sent. Neither native platform has `mode`/`rewriteRequest`/`rewriteResponse`
functions (those cannot cross a native bridge) — a native rule is routed through the
rewrite/transform path purely because it declares `redirectTo` and/or `modify`
(`MockRule.isRewrite`). On RN, `MockEngine` mirrors `mock`/`block` rules to native via
`NativeMockBridge`; `redirectTo`/`modify` are JS-only today — the native payload
(`NativeMockRulePayload`/`toNativeRule` in `packages/hakka-core/src/engine/MockEngine.ts`) does not yet
carry those fields, so a JS-authored `redirectTo`/`modify` rule applies in the RN JS interceptor
but is not mirrored to the native iOS/Android engines (JS state remains authoritative; this is a
known gap, not a semantic difference — native engines fully support `redirectTo`/`modify` when
driven directly, e.g. over the control channel).

## Wire format

Driven remotely over the [bridge control channel](/spec/control-channel/) as a `mock.add` /
`mock.remove` / `mock.clear` `ControlCommand` — identical `kind`/field shape on every platform
(`control.ts` / iOS `ControlCommand.swift` / Android `ControlCommand.kt`), including `redirectTo`,
`block`, and `modify`. On the TS engine, a matched-and-applied rule marks the captured record
`mocked: true` (mock mode) or `rewritten: true` (rewrite/redirect mode). iOS and Android capture
records have no `rewritten` flag (a smaller field set than the TS `NetworkRequest`) — a
redirectTo/modify match is recorded like a normal request (real URL/headers/status/body,
`source: urlSession`/`OKHTTP`), and a `block` match is recorded with `error: "Blocked by Hakka"`
and `status: null`.

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
- `packages/hakka-core/src/interop/msw.test.ts`
- iOS: `ios/Tests/HakkaTests/MockEngineTests.swift`, `MockRuleModifyTests.swift`,
  `URLProtocolRewriteTests.swift`, `ControlCommandTests.swift`
- Android: `android/hakka-network/src/test/kotlin/com/noodleapps/hakka/MockEngineTest.kt`,
  `MockRuleTransformTest.kt`, `HakkaInterceptorTest.kt`, `ControlCommandTest.kt`

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
