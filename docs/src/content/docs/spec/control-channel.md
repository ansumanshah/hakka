---
title: Control channel
description: Spec card — the ControlCommand contract that lets an external peer (chiefly hakka mcp) drive the mock/breakpoint/throttle engines over the bridge.
---

## What it does

The control channel is a typed command contract (`ControlCommand`) that an external peer — in
practice `hakka mcp`'s write tools — sends as a `{ type: 'control', payload }` frame over the
bridge. Parsing is strict and never throws (`parseControlCommand` returns `null` on anything
malformed); applying is fail-open (`applyControlCommand` catches every engine-call exception and
reports `{ ok: false, error }` instead of propagating it into the host app).

## Public API

```ts
import { parseControlCommand, applyControlCommand } from 'hakka-core'
import type { ControlCommand } from 'hakka-core'

const cmd = parseControlCommand(rawPayload) // ControlCommand | null — strict, never throws
if (cmd) {
  const result = applyControlCommand(cmd) // { ok: true } | { ok: false; error: string }
}
```

```ts
type ControlCommand =
  | { kind: 'mock.add'; rule: MockRuleInput & { id: string } }
  | { kind: 'mock.remove'; id: string }
  | { kind: 'mock.clear' }
  | { kind: 'breakpoint.add'; breakpoint: BreakpointInput & { id: string } }
  | { kind: 'breakpoint.remove'; id: string }
  | { kind: 'throttle.set'; profile: ThrottleProfile; latencyMs?: number; downloadKbps?: number }
```

Consumer side (a bridge client applying inbound `control` frames): `hakka mcp`'s
`ControlSender` interface is `sendControl(cmd: ControlCommand): boolean` — `true` means the
frame was handed to a connected bridge socket, not that any peer acknowledged or applied it
(fire-and-forget, no ack).

## Config keys + defaults

None — a message contract, not a configurable feature. `EXTERNAL_ID_RE` (`/^[A-Za-z0-9_-]{1,64}$/`)
bounds every caller-supplied `id`.

## Id semantics

Ids for `mock.add`/`breakpoint.add` are minted by the **remote caller**, not generated locally,
so that same peer can remove the rule later by the same id. Adding with an id that already
exists **replaces** that rule in place (replace-by-id), preserving insertion order, rather than
rejecting the add or creating a duplicate.

## Platform matrix

Not a distinct SPEC §5 row — reuses "Bridge to hub" (footnote 8), since control frames ride the
same wire as request frames:

| Capability    | RN  | iOS | Android | Web |
| ------------- | --- | --- | ------- | --- |
| Bridge to hub | ●   | ●   | ●       | ●   |

Per SPEC footnote 8, control-frame **consumers** are: web ● (worker → main-thread engines) · RN
● (`HakkaBridge`) · iOS ● (`HakkaBridgeClient` receive loop + `Common/ControlCommand.swift`) ·
Android ● (`BridgeSink`'s `WebSocketListener.onMessage` + `hakka-network/ControlCommand.kt`,
replace-by-id added to `MockEngine`/`BreakpointEngine`).

## Wire format

```json
{
  "type": "control",
  "payload": {
    "kind": "mock.add",
    "rule": {
      "id": "mcp-mock-1",
      "pattern": "/api/users",
      "enabled": true,
      "response": { "status": 200, "body": "{}" }
    }
  }
}
```

`hakka mcp`'s write tools (all fire-and-forget, no acknowledgment, DEV builds only):
`create_mock`, `promote_capture_to_mock` (freezes one already-captured request's real response
into a mock rule — pattern drops the query string, a deterministic id makes re-promotion replace
rather than duplicate, and it refuses an errored or still-pending capture), `delete_mock`,
`clear_mocks`, `set_breakpoint`, `delete_breakpoint`, `set_throttle`, `generate_mocks`
(record-then-mock: derives rules from already-captured traffic via `generateMockRules`, optionally
applying them as `mock.add` commands).

## Test anchors

- `packages/hakka-core/src/engine/control.test.ts`
- `scripts/smoke-control-roundtrip.mjs`
- `scripts/smoke-mcp-handshake.mjs`
- `packages/hakka/src/mcp/server.test.ts`

## Limits & non-goals

- No acknowledgment protocol — `sendControl()` returning `true` only means a bridge socket was
  reachable, not that any connected app actually applied the command.
- `mock.add`/`breakpoint.add` cannot carry functions (`bodyProvider`, `rewriteRequest`,
  `rewriteResponse`) over the wire — only the plain-data subset of `MockRuleInput` validates.
- `mode` is restricted to `'mock' | 'rewrite'` on the wire (no `block`/`redirectTo` mode string —
  those are separate boolean/string fields on the same rule shape).
