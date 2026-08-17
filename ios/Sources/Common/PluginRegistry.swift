import Foundation

// MARK: - HakkaPluginRegistry

/// Thread-safe store of registered plugins. Owned by ``HakkaInterceptor``.
///
/// Registration is idempotent by plugin `id` — a second `use(_:)` call with
/// the same id is silently ignored (mirrors the TS engine behaviour).
public final class HakkaPluginRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String: Entry] = [:]

    /// Ordered list of all registered plugins (registration order preserved).
    public var plugins: [any HakkaPlugin] {
        lock.lock()
        defer { lock.unlock() }
        return entries.values.sorted { $0.index < $1.index }.map(\.plugin)
    }

    /// All panels contributed by registered plugins, sorted by `order` then
    /// registration order (stable sort).
    public var panels: [HakkaPanel] {
        lock.lock()
        defer { lock.unlock() }
        return entries.values
            .sorted { $0.index < $1.index }
            .flatMap { $0.plugin.panels }
            .sorted { $0.order < $1.order }
    }

    public init() {}

    // MARK: - Registration

    /// Register `plugin`, calling `setup(ctx:)` immediately with the provided
    /// context. No-op if a plugin with the same `id` is already registered.
    ///
    /// Returns `true` when the plugin was newly registered, `false` on duplicate.
    @discardableResult
    public func use(_ plugin: any HakkaPlugin, ctx: any HakkaPluginContext) -> Bool {
        lock.lock()
        guard entries[plugin.id] == nil else {
            lock.unlock()
            return false
        }
        let index = entries.count
        entries[plugin.id] = Entry(plugin: plugin, index: index)
        lock.unlock()

        plugin.setup(ctx: ctx)
        return true
    }

    // MARK: - Private

    private struct Entry {
        let plugin: any HakkaPlugin
        let index: Int
    }
}
