import Foundation

// MARK: - HakkaInternalSocketMarker

/// Marks a `URLSession` as one of Hakka's own internal sockets — today,
/// exactly `HakkaBridgeClient`'s outbound connection to the desktop bridge
/// — so `HakkaWebSocketMonitor` (in the `HakkaNetwork` module, which depends
/// on this one, never the reverse) can recognize and skip capturing it by
/// object identity.
///
/// This replaced an earlier heuristic that inferred "this is our own
/// connection" from `configuration.protocolClasses` being explicitly `[]` —
/// the same value `openConnection()` below sets to keep its own handshake
/// from being replayed as a plain HTTP request (see that method's doc
/// comment). The heuristic was over-broad: any host-app session that
/// independently set `protocolClasses = []` for its own unrelated reasons
/// was indistinguishable from the bridge's own socket, so its native
/// WebSocket traffic silently vanished from the inspector with no warning
/// and no way to tell why. Marking the exact session this client builds,
/// rather than pattern-matching a config value any session could carry, has
/// no such false-positive: only a session this file itself hands to
/// `mark(_:)` is ever excluded.
public enum HakkaInternalSocketMarker {
    nonisolated(unsafe) private static var key: UInt8 = 0

    /// Call once, right after building the session and before creating any
    /// task on it — `HakkaWebSocketMonitor`'s swizzle runs synchronously
    /// inside `URLSession.webSocketTask(with:)`, so the marker must already
    /// be in place before that call, not after.
    public static func mark(_ session: URLSession) {
        objc_setAssociatedObject(session, &key, true, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    public static func isMarked(_ session: URLSession) -> Bool {
        (objc_getAssociatedObject(session, &key) as? Bool) ?? false
    }
}

// MARK: - HakkaBridgeClient

/// Streams finished captures to the Hakka desktop bridge hub over WebSocket.
///
/// One text frame per capture:
/// ```json
/// { "type": "request", "payload": <NetworkRequest as JSON> }
/// ```
///
/// ``sendConsole(_:)`` and ``sendStorage(_:)`` stream the same shared
/// envelope for the `console`/`storage` frame kinds.
///
/// The protocol matches `packages/hakka-bridge/src/protocol.ts` exactly.
///
/// - Opt-in: only instantiated when `HakkaConfig.bridgeURL` is non-nil.
/// - Uses `URLSessionWebSocketTask` (Foundation, no extra deps, iOS 13+ / macOS 10.15+).
/// - Reconnects with exponential back-off: 250 ms → 30 s.
/// - In-memory queue (capped at `maxQueueSize`) while disconnected.
/// - Frames are compressed on the wire via permessage-deflate (RFC 7692),
///   with nothing to configure here: `URLSessionWebSocketTask` sends a
///   `permessage-deflate` extension offer on every handshake unconditionally
///   and exposes no API to disable it (confirmed against Apple Developer
///   Forums threads 654362/678730 — Apple's own DTS engineers point to an
///   unfiled enhancement request for a way to turn it off). The desktop hub
///   (`packages/hakka-bridge/src/server.ts`) is what decides whether the
///   offer gets accepted; this client has nothing to opt into or maintain.
///
/// ## Receiving control frames
///
/// Announces native capabilities and accepts a connection-local target identity.
/// Valid targeted commands are applied once, then acknowledged on the same socket.
/// Legacy `control` frames remain supported without acknowledgments; unrelated
/// capture frames, malformed commands and unknown frame types are ignored.
public final class HakkaBridgeClient: @unchecked Sendable {

    // MARK: - Constants

    private static let minBackoffMs: Int = 250
    private static let maxBackoffMs: Int = 30_000
    private static let maxQueueSize: Int = 200

    // MARK: - Private state

    private let url: URL
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.bridge-client", qos: .utility)
    private let lock = NSLock()

    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var isStarted = false
    private var isStopped = false
    private var backoffMs = HakkaBridgeClient.minBackoffMs
    private var pendingFrames: [String] = []
    private var reconnectWorkItem: DispatchWorkItem?
    private let runtimeControl = RuntimeControlSession()

    // MARK: - Init

    /// Create a bridge client targeting the given WebSocket URL.
    ///
    /// - Parameter url: Bridge hub URL, e.g. `ws://localhost:8989`.
    public init(url: URL) {
        self.url = url
    }

    // MARK: - Lifecycle

    /// Connect to the bridge hub and begin delivering captures.
    public func start() {
        queue.async { [weak self] in self?.openConnection() }
    }

    /// Disconnect and discard pending frames.
    public func stop() {
        lock.lock()
        isStopped = true
        lock.unlock()
        queue.async { [weak self] in self?.closeConnection() }
    }

    // MARK: - Send

    /// Encode a finished request as a bridge wire frame and deliver it.
    ///
    /// If the connection is not yet open the frame is queued (up to
    /// `maxQueueSize`; oldest entry is dropped when full).
    public func send(_ request: NetworkRequest) {
        guard let frame = encodeFrame(request) else { return }
        queue.async { [weak self] in self?.deliver(frame) }
    }

    /// Encode one or more structured log entries as a `{"type":"console",...}`
    /// frame and deliver it. `payload` is always an array on the wire (see
    /// `BridgeConsoleMessage` in `protocol.ts`), even for a single entry.
    /// Queued like `send(_:)` while disconnected.
    public func sendConsole(_ entries: [LogEntry]) {
        guard !entries.isEmpty, let frame = encodeFrame(entries, type: "console") else { return }
        queue.async { [weak self] in self?.deliver(frame) }
    }

    /// Encode a named storage snapshot as a `{"type":"storage",...}` frame
    /// and deliver it. Queued like `send(_:)` while disconnected — a
    /// snapshot delivered late is still correct under snapshot-replace
    /// semantics (see `StorageSnapshot`'s doc comment), unlike a span or log
    /// line, which is why this uses the same queue rather than the
    /// fire-and-forget path.
    public func sendStorage(_ snapshot: StorageSnapshot) {
        guard let frame = encodeFrame(snapshot, type: "storage") else { return }
        queue.async { [weak self] in self?.deliver(frame) }
    }

    // MARK: - Private — connection

    private func openConnection() {
        lock.lock()
        guard !isStopped else { lock.unlock(); return }
        lock.unlock()

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        // `HakkaInterceptor.start()` swizzles `URLSessionConfiguration.default`/
        // `.ephemeral` to inject `HakkaURLProtocol` into every session built from
        // them, and separately registers it process-wide via
        // `URLProtocol.registerClass(_:)` — the normal, intended state once a
        // host app captures its own traffic AND streams to the bridge. Without
        // this, this client's own outbound WebSocket handshake gets caught by
        // that same interception (`HakkaURLProtocol.canInit` accepts it — the
        // handshake is an `http`-scheme request until it upgrades) and replayed
        // as a plain HTTP request, which cannot preserve a WebSocket upgrade and
        // drops the connection (`NSURLErrorNetworkConnectionLost`) — silently,
        // since nothing here is in a position to notice its own socket is the
        // one being intercepted. A telemetry socket must never be able to
        // capture itself, so opt this session out of custom protocol handling
        // entirely: a non-nil empty array excludes both the globally registered
        // class list and anything injected into `.default`/`.ephemeral`, unlike
        // `nil`, which defers to whatever is registered.
        config.protocolClasses = []
        let session = URLSession(configuration: config)
        // Marks this exact session as Hakka's own before any task exists on
        // it — `HakkaWebSocketMonitor`'s native-WebSocket self-exclusion
        // (in `HakkaNetwork`) keys off this instead of `protocolClasses`,
        // which a host app could independently set to `[]` for reasons that
        // have nothing to do with Hakka. See `HakkaInternalSocketMarker`.
        HakkaInternalSocketMarker.mark(session)
        let task = session.webSocketTask(with: url)
        lock.lock()
        self.session = session
        self.task = task
        isStarted = true
        lock.unlock()

        runtimeControl.reset()
        task.resume()
        struct Hello: Encodable {
            let role = "runtime"
            let runtime = "ios"
            let protocolVersion = 1
            let capabilities = RuntimeControlFrame.nativeCapabilities
        }
        if let hello = encodeRuntimeControlFrame("runtime.hello", payload: Hello()) {
            task.send(.string(hello)) { _ in }
        }
        flushQueue()
        schedulePing()
        receiveLoop(on: task)
    }

    private func closeConnection() {
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        runtimeControl.reset()
        let t: URLSessionWebSocketTask?
        let s: URLSession?
        lock.lock()
        t = task
        s = session
        task = nil
        session = nil
        lock.unlock()
        t?.cancel(with: .goingAway, reason: nil)
        s?.invalidateAndCancel()
    }

    // MARK: - Private — delivery

    private func deliver(_ frame: String) {
        lock.lock()
        let currentTask = task
        lock.unlock()
        guard let currentTask,
              currentTask.state == .running else {
            enqueue(frame)
            return
        }
        currentTask.send(.string(frame)) { [weak self] error in
            guard let self, let error else { return }
            self.queue.async { self.handleSendError(error, frame: frame) }
        }
    }

    private func handleSendError(_ error: Error, frame: String) {
        enqueue(frame)
        scheduleReconnect()
    }

    private func flushQueue() {
        lock.lock()
        let frames = pendingFrames
        pendingFrames.removeAll()
        lock.unlock()

        lock.lock()
        let currentTask = task
        lock.unlock()

        for frame in frames {
            guard let currentTask, currentTask.state == .running else {
                enqueue(frame)
                continue
            }
            currentTask.send(.string(frame)) { _ in }
        }
    }

    private func enqueue(_ frame: String) {
        lock.lock()
        if pendingFrames.count >= Self.maxQueueSize {
            pendingFrames.removeFirst()
        }
        pendingFrames.append(frame)
        lock.unlock()
    }

    // MARK: - Private — receive

    /// Start (or continue) receiving frames on `task`. Recurses after each
    /// successfully-received message so the loop stays alive for the
    /// lifetime of the socket; stops on error (the send/ping paths already
    /// own reconnect scheduling) or once `stop()`/`closeConnection()` has run.
    private func receiveLoop(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            self.lock.lock()
            let stopped = self.isStopped
            let currentTask = self.task
            self.lock.unlock()
            guard !stopped, currentTask === task else { return }

            switch result {
            case .success(let message):
                self.queue.async {
                    guard self.task === task else { return }
                    self.handleIncoming(message, on: task)
                    self.receiveLoop(on: task)
                }
            case .failure:
                // Let the ping/send error paths own reconnect scheduling —
                // avoid double-scheduling a reconnect from both places.
                break
            }
        }
    }

    /// Handle legacy and targeted control frames on the connection's serial queue.
    private func handleIncoming(_ message: URLSessionWebSocketTask.Message, on task: URLSessionWebSocketTask) {
        guard case .string(let text) = message else { return }
        if let frame = parseRuntimeControlFrame(text) {
            if let result = runtimeControl.receive(frame, apply: { applyControlCommand($0) }),
               let response = encodeRuntimeControlFrame("control.result", payload: result) {
                // Results belong to this connection and must never enter the reconnect queue.
                task.send(.string(response)) { _ in }
            }
            return
        }
        guard let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              obj["type"] as? String == "control", let command = parseControlCommand(obj["payload"]) else { return }
        applyControlCommand(command)
    }

    // MARK: - Private — reconnect + ping

    private func scheduleReconnect() {
        reconnectWorkItem?.cancel()
        lock.lock()
        guard !isStopped else { lock.unlock(); return }
        let delay = backoffMs
        backoffMs = min(backoffMs * 2, Self.maxBackoffMs)
        lock.unlock()

        closeConnection()

        let workItem = DispatchWorkItem { [weak self] in
            self?.openConnection()
        }
        reconnectWorkItem = workItem
        queue.asyncAfter(deadline: .now() + .milliseconds(delay), execute: workItem)
    }

    private func schedulePing() {
        queue.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self else { return }
            lock.lock()
            let stopped = isStopped
            let currentTask = task
            lock.unlock()

            guard !stopped, let currentTask else { return }
            guard currentTask.state == .running else {
                scheduleReconnect()
                return
            }
            currentTask.sendPing { [weak self] pingError in
                guard let self else { return }
                if pingError != nil {
                    queue.async { self.scheduleReconnect() }
                } else {
                    lock.lock()
                    backoffMs = Self.minBackoffMs
                    lock.unlock()
                    queue.async { self.schedulePing() }
                }
            }
        }
    }

}
