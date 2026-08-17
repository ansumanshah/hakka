---
title: Plugin API
description: Exact per-platform plugin type signatures — TypeScript, Swift, and Kotlin — and where they diverge.
---

Conceptual overview, a working example per platform, and the honest capability matrix live
in [Guides: Plugins](/guides/plugins/). This page is the exact signatures, sourced directly
from each platform's canonical file.

## hakka-core (TypeScript) — the canonical contract

Source: `packages/hakka-core/src/engine/plugins.ts`, aggregation methods in
`packages/hakka-core/src/engine/pluginRegistry.ts` (composed into the facade,
`packages/hakka-core/src/engine/HakkaFacade.ts`). Both iOS and Android are
hand-ported mirrors of this shape, not generated from it.

```ts
interface HakkaPanel {
  id: string
  title: string
  order?: number // lower sorts first; built-in 'network' panel is 0
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

interface HakkaPlugin {
  id: string
  panels?: HakkaPanel[]
  bodyRenderers?: HakkaBodyRenderer[]
  contextMenuItems?: HakkaContextMenuItem[]
  setup?(ctx: HakkaPluginContext): void | (() => void)
}
```

`RecordSink` (from `packages/hakka-core/src/model/contract.ts`):

```ts
type RecordSink = (record: ContractRecord) => void | Promise<void>
```

### `Hakka` methods

| Method                        | Behavior                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Hakka.use(plugin)`           | No-op if `plugin` (by object reference) is already in the registered list. Calls `setup(ctx)` immediately if capture is running, otherwise defers to the next `start()`. |
| `Hakka.getPanels()`           | All `panels` across registered plugins, flattened and sorted ascending by `order` (`?? 0`).                                                                              |
| `Hakka.getBodyRenderers()`    | All `bodyRenderers` across registered plugins, flattened. Not sorted. Not consumed by any host today.                                                                    |
| `Hakka.getContextMenuItems()` | All `contextMenuItems` across registered plugins, flattened. Not sorted. Consumed by `hakka-browser`'s `Detail` component only.                                          |

Both `hakka-react-native` and `hakka-browser` re-export the `Hakka` singleton but **do not**
re-export the `HakkaPlugin`/`HakkaPanel`/`HakkaBodyRenderer`/`HakkaContextMenuItem`/
`HakkaPluginContext` types from their own package entrypoints. Import the types from
`hakka-core` directly — it's a direct dependency of both, so it resolves without adding it
to your own `package.json`:

```ts
import type { HakkaPlugin } from 'hakka-core'
```

## iOS (Swift)

Source: `ios/Sources/Common/Plugin.swift` (`HakkaCommon`), `ios/Sources/UI/PluginPanel.swift`
(`HakkaUI`), `ios/Sources/Network/Interceptor.swift` (`HakkaNetwork`). The React Native
package's `packages/hakka-react-native/ios/Core/*.swift` files are a generated,
byte-identical sync of the `Common` files (see `scripts/sync-rn-ios.mjs` / `just sync-ios`) —
not a separate surface.

```swift
// HakkaCommon

public struct HakkaPanel: @unchecked Sendable {
    public let id: String
    public let title: String
    public let order: Int // default: 100
    public let icon: String // default: "puzzlepiece"
    public let _viewBuilderErased: Any? // type-erased SwiftUI view factory

    public init(id: String, title: String, order: Int = 100, icon: String = "puzzlepiece")

    public init(
        id: String, title: String, order: Int = 100, icon: String = "puzzlepiece",
        _erased builder: Any?
    )
}

public protocol HakkaPluginContext: Sendable {
    func ingest(_ request: NetworkRequest)

    @discardableResult
    func update(id: String, transform: @Sendable (inout NetworkRequest) -> Void) -> Bool

    func onRequest(_ listener: @escaping @Sendable (NetworkRequest) -> Void) -> HakkaPluginSubscription

    func getLogs() -> [NetworkRequest]

    func registerSink(_ sink: @escaping RecordSink) -> HakkaPluginSubscription
}

public final class HakkaPluginSubscription: @unchecked Sendable {
    public init(_ cancel: @escaping () -> Void)
    public func unsubscribe() // also called from deinit
}

public protocol HakkaPlugin: Sendable {
    var id: String { get }
    var panels: [HakkaPanel] { get } // default: []
    func setup(ctx: any HakkaPluginContext) // no teardown return — see note below
}
```

```swift
// HakkaUI — SwiftUI convenience layered on top of HakkaCommon

public extension HakkaPanel {
    var viewBuilder: (() -> AnyView)? // casts _viewBuilderErased back

    init(
        id: String, title: String, order: Int = 100, icon: String = "puzzlepiece",
        @ViewBuilder content: @escaping () -> some View
    )
}
```

```swift
// HakkaNetwork

public final class HakkaPluginRegistry: @unchecked Sendable {
    public var plugins: [any HakkaPlugin] { get } // registration order
    public var panels: [HakkaPanel] { get } // flattened, sorted by order then registration order

    @discardableResult
    public func use(_ plugin: any HakkaPlugin, ctx: any HakkaPluginContext) -> Bool
    // Dedups by plugin.id — a duplicate id is silently ignored (returns false)
    // and its setup(ctx:) is never called.
}

extension HakkaInterceptor {
    public var pluginRegistry: HakkaPluginRegistry { get }

    @discardableResult
    public func use(_ plugin: any HakkaPlugin) -> Bool
    // Calls pluginRegistry.use(plugin, ctx: pluginContext) — setup(ctx:) runs
    // synchronously, immediately, regardless of interceptor running state.
}
```

:::caution[No teardown, no exception isolation]
`HakkaPlugin.setup(ctx:)` returns `Void`. The doc comment on the protocol calls this
"reserved" for a future version — there is currently no way to unwind what a plugin's
`setup` wired up. `HakkaPluginRegistry.use()` also does not catch exceptions thrown from
`setup(ctx:)` — a throwing plugin propagates.
:::

## Android (Kotlin)

Source: `android/hakka-common/src/main/kotlin/com/noodleapps/hakka/Plugin.kt` (pure JVM,
no Android SDK), `android/hakka-ui/src/main/kotlin/com/noodleapps/hakka/ui/HakkaPanel.kt`
(Android SDK, panels), `android/hakka-network/src/main/kotlin/com/noodleapps/hakka/PluginRegistry.kt`.

```kotlin
// hakka-common — platform-neutral, no panels concept here

interface HakkaPluginContext {
    fun ingest(request: NetworkRequest)
    fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean
    fun onRequest(listener: (NetworkRequest) -> Unit): () -> Unit
    fun getLogs(): List<NetworkRequest>
    fun registerSink(sink: RecordSink): () -> Unit
}

interface HakkaPlugin {
    val id: String
    // Returns a teardown lambda, or null. Unlike iOS, teardown IS supported here.
    fun setup(ctx: HakkaPluginContext): (() -> Unit)? = null
}
```

```kotlin
// hakka-ui — adds panels; requires the Android SDK

data class HakkaPanel(
    val id: String,
    val title: String,
    val order: Int = 100, // built-ins occupy 0–9; plugin panels should start at 100+
    val icon: Int? = null, // drawable resource id, or null for text-only
    val viewFactory: (Context) -> View,
)

interface HakkaAndroidPlugin : HakkaPlugin {
    val androidPanels: List<HakkaPanel> get() = emptyList()
}
```

```kotlin
// hakka-network

class PluginRegistry internal constructor(
    private val contextProvider: () -> HakkaPluginContext,
) {
    fun use(plugin: HakkaPlugin): Boolean
    // Dedups by plugin.id. Calls setup(ctx) synchronously; catches and
    // discards any exception it throws (plugin still registers, no teardown).

    fun remove(pluginId: String): Boolean
    // Invokes the stored teardown (if any) and removes the entry.

    fun registeredPlugins(): List<HakkaPlugin>
    // Registration order. NOT sorted by anything — callers sort themselves.

    internal fun removeAll() // runs all teardowns; called from HakkaInterceptor.close()
}
```

```kotlin
// HakkaInterceptor (hakka-network)
val plugins: PluginRegistry // interceptor.plugins.use(myPlugin)

// Hakka.install(context) (hakka-ui) auto-wires the panel provider:
//   ui.attachPluginProvider { interceptor.plugins.registeredPlugins() }
// If you build your own HakkaInterceptor without Hakka.install(), call
// HakkaUI.getInstance(context).attachPluginProvider { ... } yourself or
// registered androidPanels never reach the bottom sheet.
```

Android's `HakkaBottomSheet` collects panels with:

```kotlin
HakkaUI.getInstance(ctx).interceptorPlugins()
    .filterIsInstance<HakkaAndroidPlugin>()
    .flatMap { it.androidPanels }
    .sortedBy { it.order }
```

— note the `filterIsInstance<HakkaAndroidPlugin>()`: a plugin that only implements the base
`HakkaPlugin` (no panels) is silently excluded from this list, which is correct, but it also
means a plugin author who forgets to implement `HakkaAndroidPlugin` gets no error — just no
tab.

## Cross-platform signature differences

### `update` shape differs by platform

The same conceptual operation — "mutate a logged request by id" — has three different
call shapes:

| Platform | Signature                                                                    | Semantics                                         |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| TS       | `update(partial: Partial<NetworkRequest> & { id: string }): boolean`         | Merge a partial object over the existing entry.   |
| iOS      | `update(id: String, transform: (inout NetworkRequest) -> Void) -> Bool`      | Mutate the entry in place via an `inout` closure. |
| Android  | `update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean` | Pure function — return a new, transformed copy.   |

A plugin ported from one platform to another needs its `update` call rewritten, not just
transliterated.

### Idempotency key differs

| Platform      | Dedup key                                                                                |
| ------------- | ---------------------------------------------------------------------------------------- |
| TS (web + RN) | Object identity — `this.plugins.includes(plugin)` (`Array.includes`, reference equality) |
| iOS           | `plugin.id` string equality                                                              |
| Android       | `plugin.id` string equality                                                              |

### Teardown support differs

| Platform      | Teardown                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| TS (web + RN) | `setup()` may return a teardown fn; runs on `Hakka.stop()`.                                    |
| iOS           | Not supported — `setup(ctx:)` returns `Void`. Marked "reserved" in the protocol doc comment.   |
| Android       | `setup()` may return a teardown lambda; runs on `plugins.remove(id)` or `interceptor.close()`. |

### Exception handling in `setup()` differs

| Platform      | Behavior                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| TS (web + RN) | Propagates — an uncaught throw in `setup()` surfaces to the caller of `Hakka.use()`/`Hakka.start()`. |
| iOS           | Propagates.                                                                                          |
| Android       | Caught and discarded by `PluginRegistry.use()` — plugin still registers, with no teardown.           |

### Panel descriptor shape differs

| Platform | Panel carries                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS       | `id`, `title`, `order?`, `icon?` (string hint) — a pure descriptor; the host looks up a renderer by `id`.                                                                                                                                                      |
| iOS      | Same fields plus a type-erased SwiftUI view builder embedded directly on the struct (via the `HakkaUI` convenience initializer). No external lookup needed.                                                                                                    |
| Android  | `id`, `title`, `order`, `icon` (drawable resource id), plus a `viewFactory: (Context) -> View` embedded directly on the data class. No external lookup needed. Only reachable through the separate `HakkaAndroidPlugin` interface, not the base `HakkaPlugin`. |

TypeScript's descriptor-plus-external-registry design and the two native platforms'
embedded-view-factory design are genuinely different architectures, not just syntax — see
[Guides: Plugins](/guides/plugins/#platform-capability-matrix) for what that means in
practice for where your panel content actually renders.
