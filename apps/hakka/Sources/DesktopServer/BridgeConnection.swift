import Foundation
import HakkaCommon
import Network

/// One live peer connection to the bridge hub — the production conformer of
/// `BridgeRelayPeer`, wrapping a single accepted `NWConnection` whose
/// protocol stack already includes `NWProtocolWebSocket` (the upgrade
/// handshake is handled inside the connection by that protocol layer; see
/// `BridgeServer.start`).
///
/// `@unchecked Sendable`: every callback that touches `receiveBuffer`
/// (`receiveMessage`'s completion handler) runs serialized on the single
/// `DispatchQueue` this connection was started on — Network.framework's own
/// threading contract — so there is no concurrent-mutation hazard despite
/// the compiler being unable to see that invariant. Same idiom as
/// `HakkaBridgeClient`/`NWBridgeHostBrowser` elsewhere in this codebase.
///
/// Robustness contract (must never crash, never throw out of the receive
/// loop, matching the Node hub it replaces):
/// - Malformed/partial frames: bytes accumulate in `receiveBuffer` until
///   `isComplete`; a frame that fails to decode is dropped silently.
/// - Oversized frames: `receiveBuffer` is bounded by `maxFrameBytes`
///   (defense-in-depth alongside `NWProtocolWebSocket.Options.maximumMessageSize`
///   set on the listener) — exceeding it cancels the connection instead of
///   growing the buffer unbounded.
/// - A peer disconnecting mid-frame: `nil` content (with or without an
///   error) stops the receive loop without recursing again; the connection's
///   state handler deregisters this peer from `hub` once the OS reports
///   `.failed`/`.cancelled`. Any bytes buffered from an in-flight,
///   never-completed frame are simply discarded.
/// - Ordering: assembled frames from this connection reach `hub.ingest` in
///   the exact order they finished assembling, even under a burst of
///   back-to-back messages. `handleAssembledMessage` only *yields* text onto
///   `ingestContinuation`; a single consumer `Task`, started once in `init`
///   and never re-created, drains that stream with `for await` and awaits
///   each `hub.ingest` before pulling the next item. A prior version spawned
///   a fresh, independently-created `Task { await hub.ingest(...) }` per
///   message instead — Swift gives no ordering guarantee between two
///   independently-created `Task`s reaching their first suspension point, so
///   two frames sent back-to-back by the same peer could be
///   relayed/surfaced out of order.
public final class BridgeConnection: BridgeRelayPeer, @unchecked Sendable {
    public let id: BridgePeerID = UUID()

    private let connection: NWConnection
    private let hub: BridgeHub
    private let maxFrameBytes: Int
    private var receiveBuffer = Data()
    /// Feeds the single ordered-ingestion consumer `Task` spawned in `init`.
    /// `handleAssembledMessage` calls `yield` synchronously (no suspension
    /// point) from the connection's serial queue, so yield order always
    /// matches frame-assembly order; with exactly one consumer draining the
    /// stream, `hub.ingest` calls happen in that same order.
    private let ingestContinuation: AsyncStream<String>.Continuation

    public init(connection: NWConnection, hub: BridgeHub, maxFrameBytes: Int) {
        self.connection = connection
        self.hub = hub
        self.maxFrameBytes = maxFrameBytes

        var continuation: AsyncStream<String>.Continuation?
        let stream = AsyncStream<String> { continuation = $0 }
        self.ingestContinuation = continuation!

        // Captures only `hub`/`peerID`/`stream` — not `self` — so this task
        // never keeps the connection alive and needs no `[weak self]`.
        let peerID = id
        Task {
            for await text in stream {
                await hub.ingest(text, from: peerID)
            }
        }
    }

    /// Begin this connection's lifecycle: register/deregister with `hub` as
    /// its state changes, and start the receive loop. `queue` must be the
    /// same serial queue the owning `NWListener` was started on.
    public func start(on queue: DispatchQueue) {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                Task { await self.hub.addPeer(self) }
            case .failed, .cancelled:
                Task { await self.hub.removePeer(self.id) }
                self.ingestContinuation.finish()
            default:
                break
            }
        }
        connection.start(queue: queue)
        receiveNext()
    }

    // MARK: - BridgeRelayPeer

    public func send(_ raw: String) {
        guard let data = raw.data(using: .utf8) else { return }
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "hakka-bridge-text", metadata: [metadata])
        connection.send(
            content: data,
            contentContext: context,
            isComplete: true,
            completion: .contentProcessed { [weak self] error in
                guard error != nil else { return }
                self?.connection.cancel()
            }
        )
    }

    // MARK: - Receive loop

    private func receiveNext() {
        connection.receiveMessage { [weak self] content, context, isComplete, error in
            guard let self else { return }

            if error != nil {
                self.connection.cancel()
                return
            }

            if let content, !content.isEmpty {
                guard self.receiveBuffer.count + content.count <= self.maxFrameBytes else {
                    self.receiveBuffer.removeAll()
                    self.connection.cancel()
                    return
                }
                self.receiveBuffer.append(content)
            }

            if isComplete {
                let opcode = Self.opcode(from: context)
                let assembled = self.receiveBuffer
                self.receiveBuffer.removeAll()
                self.handleAssembledMessage(assembled, opcode: opcode)
            }

            // `nil` content (with no error) signals the peer closed its send
            // side — stop recursing rather than spin; the state handler owns
            // cleanup once the OS reports the connection as no longer alive.
            guard content != nil else { return }
            self.receiveNext()
        }
    }

    private static func opcode(from context: NWConnection.ContentContext?) -> NWProtocolWebSocket.Opcode? {
        (context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata)?.opcode
    }

    /// Hands an assembled frame off for ordered ingestion — see the
    /// `ingestContinuation` doc comment above. Not `private` so
    /// `ServerTests.swift` can drive it directly (via `@testable import`)
    /// without ever calling `start(on:)`/binding a real socket, matching
    /// this file's existing no-real-ports testing philosophy.
    func handleAssembledMessage(_ data: Data, opcode: NWProtocolWebSocket.Opcode?) {
        guard opcode == .text, !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
        ingestContinuation.yield(text)
    }

    deinit {
        ingestContinuation.finish()
    }
}
