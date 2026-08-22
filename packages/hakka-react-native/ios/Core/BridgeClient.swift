// @generated — do not edit. Synced from ios/Sources/Common/BridgeClient.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

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
///
/// ## Receiving control frames
///
/// The bridge hub relays every text frame to every connected peer, so this
/// client's receive loop may see its own `{"type":"request",...}` frames
/// echoed back, as well as `{"type":"control",...}` frames from other peers
/// (e.g. the MCP server driving mock/breakpoint/throttle from a chat tool).
/// Anything that isn't a valid `{"type":"control","payload":<ControlCommand>}`
/// frame — malformed JSON, an unknown `type`, a `payload` that fails
/// `parseControlCommand` — is silently ignored; see
/// `packages/hakka-core/src/engine/control.ts` for the shared contract.
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
        let session = URLSession(configuration: config)
        let task = session.webSocketTask(with: url)
        lock.lock()
        self.session = session
        self.task = task
        isStarted = true
        lock.unlock()

        task.resume()
        flushQueue()
        schedulePing()
        receiveLoop(on: task)
    }

    private func closeConnection() {
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
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
                self.handleIncoming(message)
                self.receiveLoop(on: task)
            case .failure:
                // Let the ping/send error paths own reconnect scheduling —
                // avoid double-scheduling a reconnect from both places.
                break
            }
        }
    }

    /// Handle one inbound WebSocket message. Only `{"type":"control",...}`
    /// text frames are meaningful here; everything else (binary frames,
    /// relayed `"request"` frames, malformed JSON) is ignored.
    private func handleIncoming(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8) else { return }
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["type"] as? String == "control" else { return }
        guard let command = parseControlCommand(obj["payload"]) else { return }
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
