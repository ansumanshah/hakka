---
title: Breakpoints
description: Spec card — pause a matching request or response in-flight, edit it, then resume or abort. In-process, no proxy or certificate.
---

## What it does

`BreakpointEngine` holds a matching request or response Promise open until the overlay resolves
it, letting a developer inspect and edit fields before the request is sent or the response is
delivered to the caller. Rules match on URL substring + optional method filter, and can target
the `request` phase, the `response` phase, or `both`.

## Public API

```ts
import { breakpointEngine } from 'hakka-core'
import type { Breakpoint, BreakpointInput, BreakpointPhase, PausedEntry, PausedRequest, PausedResponse, ResumeAction, ResumeResponseAction } from 'hakka-core'

const id = breakpointEngine.addBreakpoint(input) // { pattern, method?, on?, enabled }
breakpointEngine.removeBreakpoint(id)
breakpointEngine.setEnabled(id, enabled)
breakpointEngine.getBreakpoints() // Breakpoint[]
breakpointEngine.clearBreakpoints()

breakpointEngine.getPaused() // PausedEntry[]
breakpointEngine.hasPaused() // boolean
breakpointEngine.resume(pauseId, edits?) // Partial<PausedRequest> | Partial<PausedResponse>
breakpointEngine.abort(pauseId)
breakpointEngine.resumeAll() // teardown — resumes every pending pause without edits
breakpointEngine.subscribe(listener) // () => void, fires on any rule/pause change
```

Interceptor-facing (called by `capture/fetch.ts`, not typical app code):

```ts
breakpointEngine.matches(url, method, phase) // boolean
breakpointEngine.pause(requestId, 'request', request: PausedRequest): Promise<ResumeAction>
breakpointEngine.pause(requestId, 'response', response: PausedResponse): Promise<ResumeResponseAction>
```

## Config keys + defaults

Not part of `HakkaConfig` — breakpoints are added imperatively. No global on/off flag; an empty
rule list is a no-op.

| Rule field | Default     | Description                                                 |
| ---------- | ----------- | ----------------------------------------------------------- |
| `on`       | `'request'` | Phase to pause on: `'request'` \| `'response'` \| `'both'`. |
| `method`   | any         | HTTP method filter, case-insensitive.                       |

## Platform matrix

SPEC §5 row "Breakpoints" (footnote 3):

| Capability  | RN  | iOS | Android | Web | Mac app |
| ----------- | --- | --- | ------- | --- | ------- |
| Breakpoints | ●   | ●   | ●       | ●   | ●       |

Request **and** response-phase breakpoints, pause-and-edit, no proxy or cert. The shared TS
`breakpointEngine` (`hakka-core`) is consumed by the web overlay today; iOS
(`Common/BreakpointEngine.swift`) and Android (`hakka-common`/`hakka-network-noop`
`BreakpointEngine.kt`) ship their own native ports of the same engine, driven by native panels
and by [control-channel](/spec/control-channel/) `breakpoint.add`/`breakpoint.remove` commands.

## Wire format

Driven remotely as a `breakpoint.add` / `breakpoint.remove` `ControlCommand` — see
[Control channel](/spec/control-channel/). Aborting records the request with `status: null` and
`error: 'Aborted by Hakka'`.

## Test anchors

- `packages/hakka-core/src/engine/control.test.ts` (breakpoint add/remove via `ControlCommand`)
- `packages/hakka-core/src/capture/rewrite.test.ts`, `packages/hakka-core/src/capture/xhr.test.ts`
- `packages/hakka-browser/src/ui/Breakpoints.test.tsx`
- `ios/Tests/HakkaTests/BreakpointEngineTests.swift`
- `android/hakka-common/src/test/kotlin/com/noodleapps/hakka/BreakpointEngineTest.kt`

## Limits & non-goals

- On web, breakpoints apply to `fetch` only — XHR and WebSocket traffic passes through unpaused.
- The response body is read to a string before a response-phase pause; binary responses are
  coerced to text.
- Everything runs on the main thread — a pause holds the intercepted request Promise open until
  the overlay resolves it; there is no timeout, so `resumeAll()` must run on teardown to avoid
  dangling Promises.
