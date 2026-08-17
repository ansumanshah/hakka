import Foundation
#if canImport(HakkaCommon)
import HakkaCommon
#endif

/// Main entry point for Hakka network interception.
///
/// Registers a `URLProtocol` subclass to capture HTTP/HTTPS requests.
/// Also swizzles `URLSessionConfiguration.default` and `.ephemeral` to
/// ensure interception works with all `URLSession` instances.
///
/// Usage:
/// ```swift
/// let interceptor = HakkaInterceptor(config: .default)
/// interceptor.onRequest = { request in print(request) }
/// interceptor.start()
/// ```
public final class HakkaInterceptor: @unchecked Sendable {
    /// Shared singleton for convenience.
    public static let shared = HakkaInterceptor()

    /// Configuration.
    public var config: HakkaConfig {
        configLock.lock()
        defer { configLock.unlock() }
        return _config
    }

    /// In-memory log store.
    public let store: LogStore

    /// Dedicated structured-log ring buffer (separate from ``store``, which
    /// holds captured ``NetworkRequest`` records). Backs ``log(_:_:category:metadata:)``
    /// and the Logs inspector panel.
    public let logStore = HakkaLogStore()

    /// Retention policy derived from the current runtime configuration.
    public var retentionPolicy: RetentionPolicy {
        let currentConfig = config
        return RetentionPolicy(maxCount: currentConfig.maxRequests, maxAge: currentConfig.maxAge)
    }

    /// Delegate for receiving captured requests.
    public weak var delegate: HakkaDelegate?

    /// Closure-based callback (alternative to delegate).
    public var onRequest: HakkaRequestHandler?

    /// Hosts found on the LAN by bridge auto-discovery when more than one was found (see
    /// `HakkaConfig.bridgeAutoDiscoveryEnabled`). Empty when discovery hasn't run, found
    /// zero hosts, or found exactly one host (which is auto-connected instead of listed
    /// here). Intended for a settings surface to let the developer pick among them.
    public var discoveredBridgeHosts: [DiscoveredBridgeHost] {
        bridgeLock.lock()
        defer { bridgeLock.unlock() }
        return _discoveredBridgeHosts
    }

    /// Invoked once bridge auto-discovery settles on an outcome (0/1/many hosts) — the
    /// same outcome that drives the interceptor's own auto-connect/expose decision. Wire
    /// this to refresh UI (e.g. `SettingsView`'s "discovered on LAN" list).
    public var onBridgeHostsDiscovered: ((BridgeDiscoverySelection) -> Void)?

    /// Whether interception is currently active.
    public private(set) var isRunning: Bool = false

    /// Whether capture is currently paused.
    ///
    /// While paused, completed requests are buffered in memory.
    /// Calling ``resume()`` flushes the buffer into the log store in order.
    public private(set) var isPaused: Bool = false

    private let lock = NSLock()
    private let configLock = NSLock()
    private let inFlightLock = NSLock()
    private let pauseLock = NSLock()
    private let listenersLock = NSLock()
    private let bridgeLock = NSLock()
    private let captureProcessor = HakkaCaptureProcessor()
    private let recordSinks: RecordSinkHub
    private var _config: HakkaConfig
    private var inFlight: [String: NetworkRequest] = [:]
    private var pauseBuffer: [NetworkRequest] = []
    private var bridgeClient: HakkaBridgeClient?
    private var bridgeDiscovery: HakkaBridgeDiscovery?
    private var _discoveredBridgeHosts: [DiscoveredBridgeHost] = []
    private var requestListeners: [UUID: @Sendable (NetworkRequest) -> Void] = [:]
    private nonisolated(unsafe) static var swizzled = false

    /// Bumped (under `bridgeLock`) every time ``start()``/``stop()`` runs. A discovery
    /// completion captures the generation in effect when it began and compares it against
    /// the current value before acting — see ``completeBridgeDiscovery(_:generation:)``.
    /// This is *not* redundant with `HakkaBridgeDiscovery`'s own `stop()`: that call only
    /// cancels a *not-yet-started* timeout `DispatchWorkItem`, so a completion that has
    /// already begun running when `stop()` races it cannot be preempted there — without
    /// this generation check it would still create/start a `HakkaBridgeClient` after the
    /// interceptor was told to stop.
    private var bridgeGeneration: Int = 0

    /// Factory for the LAN-browsing transport used by bridge discovery. Internal (not
    /// public) test seam — production always uses the default (`NWBridgeHostBrowser()`);
    /// tests substitute a faked `BridgeHostBrowsing` via `@testable import` to exercise
    /// discovery (including the stop/completion race) without real Bonjour/mDNS.
    var bridgeHostBrowserFactoryForTest: (() -> BridgeHostBrowsing)?

    /// Test-only hook invoked once a discovery completion has been handled, whether it
    /// applied its selection or was discarded as stale (see
    /// ``completeBridgeDiscovery(_:generation:)``). Lets tests await the full completion
    /// path deterministically instead of sleeping.
    var debugOnDiscoveryCompletionHandledForTest: (() -> Void)?

    /// Test-only observability for the bridge client's presence, since `bridgeClient`
    /// itself is private.
    var debugHasBridgeClientForTest: Bool {
        bridgeLock.lock()
        defer { bridgeLock.unlock() }
        return bridgeClient != nil
    }

    // MARK: - Plugin registry

    /// Shared plugin registry. Use ``use(_:)`` to register plugins.
    public let pluginRegistry = HakkaPluginRegistry()

    private lazy var pluginContext: any HakkaPluginContext = InterceptorPluginContext(interceptor: self)

    public init(config: HakkaConfig = .default) {
        self._config = config
        self.store = LogStore(capacity: config.maxRequests)
        self.recordSinks = RecordSinkHub(maxPending: config.maxRequests)
        if let bridgeURL = config.bridgeURL {
            self.bridgeClient = HakkaBridgeClient(url: bridgeURL)
        }
    }

    /// Update runtime capture configuration.
    ///
    /// `maxRequests` is fixed for an interceptor instance because it defines the
    /// ring buffer capacity. Other fields are read by the capture path for new
    /// requests after this update.
    public func updateConfig(_ transform: (HakkaConfig) -> HakkaConfig) {
        configLock.lock()
        defer { configLock.unlock() }
        let next = transform(_config)
        _config = next.replacing(maxRequests: _config.maxRequests)
    }

    /// Start intercepting network requests.
    public func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !isRunning else { return }
        isRunning = true

        HakkaURLProtocol.interceptor = self
        URLProtocol.registerClass(HakkaURLProtocol.self)
        Self.swizzleSessionConfigurationIfNeeded()

        if _config.captureNativeWebSocket {
            enableNativeWebSocket()
        }
        bridgeLock.lock()
        bridgeGeneration += 1
        let client = bridgeClient
        bridgeLock.unlock()
        client?.start()
        startBridgeDiscoveryIfNeeded()
    }

    /// Stop intercepting network requests.
    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard isRunning else { return }
        isRunning = false

        URLProtocol.unregisterClass(HakkaURLProtocol.self)
        HakkaURLProtocol.interceptor = nil
        if #available(iOS 13.0, macOS 10.15, *) {
            HakkaWebSocketMonitor.uninstall()
        }
        bridgeLock.lock()
        bridgeGeneration += 1
        let client = bridgeClient
        let discovery = bridgeDiscovery
        bridgeDiscovery = nil
        bridgeLock.unlock()
        client?.stop()
        discovery?.stop()
    }

    // MARK: - Bridge auto-discovery

    /// Kicks off LAN discovery for a `_hakka._tcp` bridge hub when `bridgeURL` is unset and
    /// `bridgeAutoDiscoveryEnabled` opts in. No-op otherwise. See
    /// `HakkaConfig.bridgeAutoDiscoveryEnabled` for the full rationale and
    /// `HakkaBridgeDiscovery` for the 0/1/many selection semantics.
    private func startBridgeDiscoveryIfNeeded() {
        guard _config.bridgeURL == nil, _config.bridgeAutoDiscoveryEnabled else { return }
        beginBridgeDiscovery(timeout: 5)
    }

    /// Manually (re)starts LAN discovery once — independent of
    /// `HakkaConfig.bridgeAutoDiscoveryEnabled` and regardless of whether `bridgeURL` is
    /// set. Intended for an explicit "Discover on LAN" action in a settings surface, since
    /// automatic discovery is opt-in by design (see `HakkaConfig.bridgeAutoDiscoveryEnabled`).
    /// Applies the same 0/1/many selection semantics as automatic discovery.
    ///
    /// - Returns: `false` if discovery is already in progress (no-op); `true` otherwise.
    @discardableResult
    public func discoverBridge(timeout: TimeInterval = 5) -> Bool {
        beginBridgeDiscovery(timeout: timeout)
    }

    @discardableResult
    private func beginBridgeDiscovery(timeout: TimeInterval) -> Bool {
        bridgeLock.lock()
        guard bridgeDiscovery == nil else { bridgeLock.unlock(); return false }
        let browser = bridgeHostBrowserFactoryForTest?() ?? NWBridgeHostBrowser()
        let discovery = HakkaBridgeDiscovery(browser: browser, timeout: timeout)
        bridgeDiscovery = discovery
        let generation = bridgeGeneration
        bridgeLock.unlock()

        discovery.start { [weak self] selection in
            self?.completeBridgeDiscovery(selection, generation: generation)
        }
        return true
    }

    /// Applies a discovery completion iff `generation` still matches the current bridge
    /// generation — i.e. ``stop()`` hasn't run since this discovery began. See
    /// ``bridgeGeneration``'s doc comment for why this check is necessary even though
    /// `stop()` also calls `discovery?.stop()`.
    private func completeBridgeDiscovery(_ selection: BridgeDiscoverySelection, generation: Int) {
        defer { debugOnDiscoveryCompletionHandledForTest?() }

        bridgeLock.lock()
        guard bridgeGeneration == generation else {
            bridgeLock.unlock()
            return
        }
        bridgeDiscovery = nil
        bridgeLock.unlock()
        applyBridgeDiscoverySelection(selection)
    }

    /// Applies a settled `BridgeDiscoverySelection`: connects automatically for exactly one
    /// host, exposes the list for many, and does nothing for zero (graceful timeout,
    /// identical to today's no-`bridgeURL` behavior).
    private func applyBridgeDiscoverySelection(_ selection: BridgeDiscoverySelection) {
        var clientToStart: HakkaBridgeClient?

        bridgeLock.lock()
        switch selection {
        case .none:
            _discoveredBridgeHosts = []
        case .autoConnect(let host):
            _discoveredBridgeHosts = []
            if let url = host.webSocketURL {
                let client = HakkaBridgeClient(url: url)
                bridgeClient = client
                clientToStart = client
            }
        case .ambiguous(let hosts):
            _discoveredBridgeHosts = hosts
        }
        bridgeLock.unlock()

        clientToStart?.start()
        onBridgeHostsDiscovered?(selection)
    }

    /// Enable native WebSocket capture (iOS 13+ only; no-op on older OS).
    public func enableNativeWebSocket() {
        if #available(iOS 13.0, macOS 10.15, *) {
            HakkaWebSocketMonitor.installGlobally(interceptor: self)
        }
    }

    /// Whether native WebSocket capture is currently active.
    public var isNativeWebSocketCapturing: Bool {
        if #available(iOS 13.0, macOS 10.15, *) {
            return HakkaWebSocketMonitor.globalInterceptor != nil
        }
        return false
    }

    /// Pause capture. Requests that complete while paused are buffered and
    /// will be committed to the store in order when ``resume()`` is called.
    public func pause() {
        pauseLock.lock()
        defer { pauseLock.unlock() }
        isPaused = true
    }

    /// Resume capture, flushing any buffered requests into the store.
    public func resume() {
        pauseLock.lock()
        isPaused = false
        let buffered = pauseBuffer
        pauseBuffer.removeAll()
        pauseLock.unlock()
        for request in buffered {
            commitProcessedCapture(request)
        }
    }

    /// Clear all stored requests.
    public func clear() {
        store.clear()
    }

    /// Returns the last `count` captured requests, newest first. Use for crash-attach.
    public func recentRequests(count: Int = 20) -> [NetworkRequest] {
        store.recent(count)
    }

    /// Returns aggregate network metrics without materializing bridge dictionaries.
    public func networkMetricsSummary() -> NetworkMetricsSummary {
        store.metricsSummary()
    }

    // MARK: - Plugin API

    /// Register a plugin. Idempotent by `plugin.id` — duplicate ids are silently ignored.
    ///
    /// The plugin's `setup(ctx:)` is called immediately so it can wire sinks and
    /// subscribe to requests. Call this before ``start()`` to ensure setup runs
    /// before any traffic arrives, though calling after is also safe.
    ///
    /// - Returns: `true` when newly registered, `false` when the id was already present.
    @discardableResult
    public func use(_ plugin: any HakkaPlugin) -> Bool {
        pluginRegistry.use(plugin, ctx: pluginContext)
    }

    // MARK: - Request listener fan-out

    /// Add a listener called for every committed request (after store + sinks).
    /// Returns a subscription token — cancel it to stop delivery.
    public func addRequestListener(_ listener: @escaping @Sendable (NetworkRequest) -> Void) -> SinkSubscription {
        let id = UUID()
        listenersLock.lock()
        requestListeners[id] = listener
        listenersLock.unlock()
        return SinkSubscription { [weak self] in
            self?.listenersLock.lock()
            self?.requestListeners.removeValue(forKey: id)
            self?.listenersLock.unlock()
        }
    }

    // MARK: - In-flight

    /// Returns a snapshot of requests that have started but not yet received a response.
    public func inFlightRequests() -> [NetworkRequest] {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        return Array(inFlight.values)
    }

    func registerInFlight(_ request: NetworkRequest) {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        inFlight[request.id] = request
    }

    func removeInFlight(id: String) {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        inFlight.removeValue(forKey: id)
    }

    // MARK: - Internal

    func didCapture(_ request: NetworkRequest) {
        captureProcessor.enqueue(request, interceptor: self)
    }

    func enqueueCompletedCapture(_ capture: HakkaCompletedCapture) {
        captureProcessor.enqueue(capture, interceptor: self)
    }

    func flushCaptureProcessing() {
        captureProcessor.sync()
    }

    public func addSink(_ sink: @escaping RecordSink) -> SinkSubscription {
        recordSinks.add(sink)
    }

    @discardableResult
    public func flushSinks(timeout: TimeInterval = 5) -> Bool {
        recordSinks.flush(timeout: timeout)
    }

    public func droppedSinkRecords() -> Int {
        recordSinks.droppedCount()
    }

    /// Emit an externally-produced record (breadcrumb, trace, …) into the sink
    /// fan-out, alongside captured network records. Bridges use this to export
    /// observability events through the same path as `commitProcessedCapture`.
    public func inject(_ record: any ContractRecord) {
        recordSinks.emit(record)
    }

    /// Builds a native health report from the current bounded store snapshot.
    public func healthReport(
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        sessionId: String? = nil,
        tags: [String: String] = [:]
    ) -> HealthReportRecord {
        let requests = store.requests
        let inFlightCount = inFlightRequests().count
        let droppedSinkRecords = droppedSinkRecords()
        let currentConfig = config
        let redactionFieldCount = currentConfig.redactHeaders.count
            + currentConfig.sensitiveQueryItems.count
            + currentConfig.sensitiveBodyFields.count

        var healthTags = tags
        healthTags["component.capture.inFlightCount"] = String(inFlightCount)
        healthTags["component.storage.count"] = String(requests.count)
        healthTags["component.storage.maxCount"] = String(currentConfig.maxRequests)
        healthTags["component.redaction.headerCount"] = String(currentConfig.redactHeaders.count)
        healthTags["component.redaction.queryItemCount"] = String(currentConfig.sensitiveQueryItems.count)
        healthTags["component.redaction.bodyFieldCount"] = String(currentConfig.sensitiveBodyFields.count)

        let captureStatus: String
        if inFlightCount > 0 {
            captureStatus = "active"
        } else {
            captureStatus = isRunning ? "running" : "stopped"
        }

        return HealthReportGenerator.generate(
            from: requests.map { NetworkRecord.from($0, id: $0.id, timestamp: $0.startTime) },
            options: HealthReportBuildOptions(
                timestamp: timestamp,
                sessionId: sessionId,
                tags: healthTags,
                componentHealth: [
                    "capture": HealthComponentStatus(status: captureStatus),
                    "storage": HealthComponentStatus(status: "ok"),
                    "redaction": HealthComponentStatus(
                        status: redactionFieldCount > 0 ? "configured" : "disabled"
                    ),
                    "sink": HealthComponentStatus(
                        status: droppedSinkRecords > 0 ? "dropping" : "ok",
                        droppedCount: Int64(droppedSinkRecords)
                    ),
                ]
            )
        )
    }

    func commitProcessedCapture(_ request: NetworkRequest) {
        pauseLock.lock()
        if isPaused {
            pauseBuffer.append(request)
            pauseLock.unlock()
            return
        }
        pauseLock.unlock()

        store.add(request)
        retentionPolicy.enforce(on: store)
        recordSinks.emit(NetworkRecord.from(request, id: request.id, timestamp: request.startTime))
        bridgeLock.lock()
        let client = bridgeClient
        bridgeLock.unlock()
        client?.send(request)
        delegate?.hakkaDidCapture(request)
        onRequest?(request)

        listenersLock.lock()
        let listeners = Array(requestListeners.values)
        listenersLock.unlock()
        for listener in listeners {
            listener(request)
        }
    }

    func shouldIgnore(url: URL) -> Bool {
        let currentConfig = config
        if let host = url.host, currentConfig.shouldIgnoreHost(host) {
            return true
        }
        return currentConfig.shouldIgnoreURL(url.absoluteString)
    }

    // MARK: - Structured Logging

    /// Append a structured ``LogEntry`` to ``logStore``. Never throws — logging
    /// must never be able to crash the host app, so all failures are swallowed.
    ///
    /// `metadata` is run through ``HakkaConfig/redactMetadata(_:)`` first, so any
    /// developer-configured `sensitiveBodyFields` are scrubbed from log fields
    /// too, not just network bodies.
    public func log(_ level: LogLevel, _ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        let redacted = metadata.map { config.redactMetadata($0) }
        let entry = LogEntry(level: level, message: message, category: category, metadata: redacted)
        logStore.add(entry)
    }

    /// Convenience: append a debug-level entry.
    public func logDebug(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.debug, message, category: category, metadata: metadata)
    }

    /// Convenience: append an info-level entry.
    public func logInfo(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.info, message, category: category, metadata: metadata)
    }

    /// Convenience: append a warn-level entry.
    public func logWarn(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.warn, message, category: category, metadata: metadata)
    }

    /// Convenience: append an error-level entry.
    public func logError(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.error, message, category: category, metadata: metadata)
    }

    // MARK: - Swizzling

    private static func swizzleSessionConfigurationIfNeeded() {
        guard !swizzled else { return }
        swizzled = true

        // Swizzle URLSessionConfiguration.default getter
        let defaultSel = #selector(getter: URLSessionConfiguration.hakka_defaultWithProtocol)
        let originalDefaultSel = #selector(getter: URLSessionConfiguration.`default`)
        if let original = class_getClassMethod(URLSessionConfiguration.self, originalDefaultSel),
           let swizzledMethod = class_getClassMethod(URLSessionConfiguration.self, defaultSel) {
            method_exchangeImplementations(original, swizzledMethod)
        }

        // Swizzle URLSessionConfiguration.ephemeral getter
        let ephemeralSel = #selector(getter: URLSessionConfiguration.hakka_ephemeralWithProtocol)
        let originalEphemeralSel = #selector(getter: URLSessionConfiguration.ephemeral)
        if let original = class_getClassMethod(URLSessionConfiguration.self, originalEphemeralSel),
           let swizzledMethod = class_getClassMethod(URLSessionConfiguration.self, ephemeralSel) {
            method_exchangeImplementations(original, swizzledMethod)
        }
    }

}
