---
title: Plugins
description: Spec card — the HakkaPlugin seam that lets every platform extend the shared engine with capture sources, sinks, and UI panel descriptors the same way.
---

## What it does

A `HakkaPlugin` contributes UI panels, body renderers, and context-menu items as
platform-neutral descriptors, and/or wires capture/sinks into the engine via `setup(ctx)`. Each
host (web Solid, RN, SwiftUI, Compose, Flutter) maps a panel `id` to its own native renderer, so
the panel _set_ stays identical across platforms while rendering itself stays native.

## Public API

```ts
import { Hakka } from 'hakka-core'
import type { HakkaPlugin, HakkaPanel, HakkaPluginContext, HakkaBodyRenderer, HakkaContextMenuItem } from 'hakka-core'

Hakka.use(plugin) // idempotent — registering the same plugin twice is a no-op
Hakka.getPanels() // HakkaPanel[], sorted by order (built-in 'network' is order 0)
Hakka.getBodyRenderers() // HakkaBodyRenderer[]
Hakka.getContextMenuItems() // HakkaContextMenuItem[]
```

```ts
interface HakkaPlugin {
  id: string
  panels?: HakkaPanel[]
  bodyRenderers?: HakkaBodyRenderer[]
  contextMenuItems?: HakkaContextMenuItem[]
  setup?(ctx: HakkaPluginContext): void | (() => void) // teardown called on Hakka.stop()
}
interface HakkaPanel {
  id: string
  title: string
  order?: number
  icon?: string
}
interface HakkaBodyRenderer {
  id: string
  match(req: NetworkRequest): boolean
}
interface HakkaContextMenuItem {
  id: string
  label: string
  run(req: NetworkRequest): void
}
interface HakkaPluginContext {
  ingest(request: NetworkRequest): void
  update(partial: Partial<NetworkRequest> & { id: string }): boolean
  onRequest(listener: (request: NetworkRequest) => void): () => void
  getLogs(): NetworkRequest[]
  registerSink(sink: RecordSink): () => void
}
```

## Config keys + defaults

None — plugins are registered imperatively via `Hakka.use()`, not through `HakkaConfig`.

## Platform matrix

SPEC §5 row "Plugin system":

| Capability    | RN  | iOS | Android | Web | Mac app |
| ------------- | --- | --- | ------- | --- | ------- |
| Plugin system | ●   | ●   | ●       | ●   | —       |

SPEC marks the RN cell `●(core)` — RN consumes the same core-TS plugin system directly (no
separate RN-native plugin layer); iOS and Android ship their own native equivalents.

## Wire format

None — an in-process registration API, not a wire concept. Built-in engines (`mockEngine`,
`ThrottleEngine`, `breakpointEngine`) and capture sources (Resource Timing, `sendBeacon`,
console, decoders) are themselves implemented as plugins that ship pre-registered.

## Test anchors

- `packages/hakka-core/src/engine/orchestrator.test.ts`

## Limits & non-goals

- `setup()` runs when capture starts (or immediately if already running) — a plugin registered
  before `Hakka.start()` and one registered after both get exactly one `setup()` call.
- No plugin marketplace, custom-renderer registry, or runtime userland plugin loading — those
  are SPEC 2.0 roadmap items, not shipped.
- Panels are descriptors only; the plugin system does not ship a cross-platform renderer — each
  host must still implement a renderer for any panel `id` it wants to display.
