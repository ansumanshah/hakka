// @generated — do not edit. Synced from ios/Sources/Common/Plugin.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - HakkaPanel

/// Descriptor for a UI panel contributed by a plugin.
///
/// Mirrors the TypeScript `HakkaPanel` descriptor. Native platforms extend
/// this with a view factory: on iOS/SwiftUI the UI target casts
/// ``_viewBuilderErased`` back to `() -> any View`; other platforms ignore it.
///
/// `order` appends after built-in tabs (lower is earlier; built-ins use < 0
/// internally, so any positive `order` comes after them). `icon` is an
/// SF Symbol name used in the tab bar.
public struct HakkaPanel: @unchecked Sendable {
    /// Stable id (unique across all registered plugins).
    public let id: String
    /// Display title shown in the tab bar label.
    public let title: String
    /// Lower sorts first, after built-in tabs. Default: 100.
    public let order: Int
    /// SF Symbol name for the tab icon. Default: "puzzlepiece".
    public let icon: String
    /// Type-erased SwiftUI view factory. The UI layer casts this to the
    /// concrete type it needs. Stored as `Any?` so `Common` stays SwiftUI-free.
    public let _viewBuilderErased: Any?

    /// Create a descriptor without a view builder (test / non-UI contexts).
    public init(id: String, title: String, order: Int = 100, icon: String = "puzzlepiece") {
        self.id = id
        self.title = title
        self.order = order
        self.icon = icon
        self._viewBuilderErased = nil
    }

    /// Create a descriptor carrying a type-erased view builder.
    /// The UI layer uses ``HakkaPanel/viewBuilder`` (defined in `HakkaUI`) to
    /// cast it back to the appropriate SwiftUI factory type.
    public init(
        id: String,
        title: String,
        order: Int = 100,
        icon: String = "puzzlepiece",
        _erased builder: Any?
    ) {
        self.id = id
        self.title = title
        self.order = order
        self.icon = icon
        self._viewBuilderErased = builder
    }
}

// MARK: - HakkaPluginContext

/// Engine capabilities exposed to a plugin during `setup`.
///
/// Mirrors the TypeScript `HakkaPluginContext` contract: ingest, update,
/// onRequest, getLogs, registerSink.
public protocol HakkaPluginContext: Sendable {
    /// Push a `NetworkRequest` through the normal dedup/retention/sink path.
    func ingest(_ request: NetworkRequest)

    /// Merge a partial update by id into an existing log entry.
    /// Returns `false` when no entry with that id exists.
    @discardableResult
    func update(id: String, transform: @Sendable (inout NetworkRequest) -> Void) -> Bool

    /// Subscribe to every committed request. The listener is called on an
    /// internal queue; dispatch to the main actor yourself if you need UI updates.
    /// Returns a cancellation token — hold it for the lifetime of the subscription.
    func onRequest(_ listener: @escaping @Sendable (NetworkRequest) -> Void) -> HakkaPluginSubscription

    /// Snapshot of all currently stored requests (oldest first).
    func getLogs() -> [NetworkRequest]

    /// Register a `RecordSink` for the lifetime of the plugin.
    /// Returns a cancellation token.
    func registerSink(_ sink: @escaping RecordSink) -> HakkaPluginSubscription
}

// MARK: - HakkaPluginSubscription

/// Opaque cancellation token returned by context subscription methods.
public final class HakkaPluginSubscription: @unchecked Sendable {
    private let lock = NSLock()
    private var cancel: (() -> Void)?

    public init(_ cancel: @escaping () -> Void) {
        self.cancel = cancel
    }

    /// Cancel the subscription / unregister the sink.
    public func unsubscribe() {
        lock.lock()
        let fn = cancel
        cancel = nil
        lock.unlock()
        fn?()
    }

    deinit { unsubscribe() }
}

// MARK: - HakkaPlugin

/// A Hakka plugin. Conform to this protocol and register with
/// `HakkaInterceptor.shared.use(myPlugin)`.
///
/// - `id` must be stable and unique — used for idempotency checks.
/// - `panels` are UI panels the host appends to its tab bar.
/// - `setup(ctx:)` wires capture/sinks; return a teardown closure to undo work
///   when the plugin is removed (not yet exposed in v1, but reserved).
public protocol HakkaPlugin: Sendable {
    /// Stable, unique plugin id.
    var id: String { get }

    /// UI panels this plugin contributes (optional).
    var panels: [HakkaPanel] { get }

    /// Wire capture/sinks into the engine.
    /// Return a teardown closure (called on unregister) or omit it.
    func setup(ctx: any HakkaPluginContext)
}

// Default implementations so minimal plugins only need `id`.
public extension HakkaPlugin {
    var panels: [HakkaPanel] { [] }
    func setup(ctx: any HakkaPluginContext) {}
}
