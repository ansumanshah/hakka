import Foundation
import HakkaCommon
import HakkaCore

/// Identifies one connected bridge peer for relay bookkeeping (send target,
/// sender exclusion). One per `BridgeConnection`/fake peer for the lifetime
/// of that connection.
public typealias BridgePeerID = UUID

/// A connected bridge peer the hub can relay a raw frame to.
/// `BridgeConnection` is the production conformer (one real `NWConnection`
/// per peer); tests inject an in-process fake so relay logic is exercised
/// without ever binding a real port.
public protocol BridgeRelayPeer: Sendable {
    var id: BridgePeerID { get }
    /// Deliver `raw` to this peer. Must not block or throw — a slow/dead
    /// peer must never stall ingestion for every other peer.
    func send(_ raw: String)
    /// Terminate this peer's underlying connection. `BridgeHub.closeAllPeers()`
    /// calls this on every registered peer — the `BridgeServer.stop()` half
    /// of shutdown, so an already-accepted connection is actually
    /// disconnected instead of staying live and registered here after the
    /// listener reports itself stopped.
    func close()
}

/// Outcome of ingesting one raw frame — returned so callers/tests can
/// observe what happened without re-parsing.
public struct BridgeIngestResult: Sendable, Equatable {
    public let kind: BridgeFrameKind
    /// Set only for `.request` frames whose payload decoded into
    /// `NetworkRequest` — see `BridgeFrame.request`.
    public let request: NetworkRequest?
    /// Set only for `.span` frames whose payload decoded into
    /// `FrameworkSpan` — see `BridgeFrame.span`.
    public let span: FrameworkSpan?
    /// Set only for `.console` frames whose payload decoded into
    /// `[LogEntry]` — see `BridgeFrame.console`.
    public let console: [LogEntry]?
    /// Set only for `.storage` frames whose payload decoded into
    /// `StorageSnapshot` — see `BridgeFrame.storage`.
    public let storage: StorageSnapshot?

    public init(
        kind: BridgeFrameKind,
        request: NetworkRequest? = nil,
        span: FrameworkSpan? = nil,
        console: [LogEntry]? = nil,
        storage: StorageSnapshot? = nil
    ) {
        self.kind = kind
        self.request = request
        self.span = span
        self.console = console
        self.storage = storage
    }
}

/// A captured `.request` frame paired with the identity of the peer that
/// sent it. `NetworkRequest` itself never carries this — see
/// `BridgeDeviceLabel`'s doc comment for why — so this is the desktop app's
/// own pairing, built only from what the hub observes at ingest time.
public struct CapturedRequest: Sendable, Equatable {
    public let request: NetworkRequest
    public let peerID: BridgePeerID
    public let deviceLabel: BridgeDeviceLabel

    /// Forwards `request.id` so call sites that only care about identity
    /// (existing tests included) don't need to reach through `.request`.
    public var id: String { request.id }
}

/// Transport-agnostic core of the desktop bridge hub — the Swift mirror of
/// `packages/hakka-bridge/src/BridgeHub.ts`'s relay behavior. Parses each raw
/// frame with `parseBridgeFrame`; a frame that parses is relayed verbatim to
/// every OTHER connected peer regardless of kind (`server.ts`'s message
/// handler relays `request`/`span`/`control` alike — this hub matches that
/// rather than special-casing `request` out), and `.request` frames are also
/// decoded and fanned out to `subscribeRequests()` callers for the desktop
/// app's own capture UI.
///
/// Deliberately does not port `BridgeHub.ts`'s request/span backlog + replay
/// (buffered so a freshly-connected *browser viewer* sees history): the
/// desktop app is the one local consumer of a request subscription, not a
/// dashboard other peers connect to inspect, so there is no "late joiner" to
/// replay to.
///
/// Each channel (`requests`, `hostControls`, `spans`, `consoleEntries`,
/// `storageSnapshots`, `deviceEvents`) is exposed as a `subscribeX()` method
/// (`BridgeHub+Subscriptions.swift`) rather than a stored `AsyncStream`.
/// Every call returns a FRESH stream backed by its own continuation, held in
/// this actor's per-channel dictionary below; `ingest`/`addPeer`/`removePeer`
/// fan a value out to every live continuation on the relevant channel, and a
/// subscription's `onTermination` deregisters only that one continuation.
///
/// This replaced six stored, single-consumer `AsyncStream` properties — see
/// ADR 0013. Cancelling a `Task` suspended in `AsyncStream.Iterator.next()`
/// finishes that stream's storage permanently, for every iterator ever drawn
/// from the same stream value, not just the cancelled one. With a stored
/// stream, `TrafficModel.start()`'s consumers dying when a window closed
/// (SwiftUI cancels the scene's `.task`) meant the channel was gone for the
/// rest of the process — a later `start()` from a reopened window
/// re-subscribed to an already-finished stream and received nothing, ever
/// again. A fresh subscription per `start()` call closes that gap: only the
/// cancelled subscription dies.
public actor BridgeHub {
    private var peers: [BridgePeerID: any BridgeRelayPeer] = [:]
    /// Assigns "Device N" labels to peers as their frames are first seen —
    /// see `BridgeDeviceLabel.swift` for why this is the honest amount of
    /// identity the hub can offer.
    private var deviceLabeler = BridgeDeviceLabeler()

    // Per-channel subscriber continuations, keyed by a subscription id
    // private to that one `subscribeX()` call. Declared here rather than in
    // `BridgeHub+Subscriptions.swift` because an extension cannot add stored
    // properties; not `private` because that extension needs to reach them.
    var requestSubscribers: [UUID: AsyncStream<CapturedRequest>.Continuation] = [:]
    var hostControlSubscribers: [UUID: AsyncStream<ControlCommand>.Continuation] = [:]
    var spanSubscribers: [UUID: AsyncStream<FrameworkSpan>.Continuation] = [:]
    var consoleSubscribers: [UUID: AsyncStream<[LogEntry]>.Continuation] = [:]
    var storageSubscribers: [UUID: AsyncStream<StorageSnapshot>.Continuation] = [:]
    var deviceEventSubscribers: [UUID: AsyncStream<BridgeDeviceEvent>.Continuation] = [:]

    public init() {}

    public var peerCount: Int { peers.count }

    public func addPeer(_ peer: any BridgeRelayPeer) {
        peers[peer.id] = peer
        for continuation in deviceEventSubscribers.values {
            continuation.yield(.connected(peer.id))
        }
    }

    public func removePeer(_ id: BridgePeerID) {
        // Only a peer that was actually registered can meaningfully
        // disconnect — guards against a duplicate `.failed`/`.cancelled`
        // delivery (or an id that was never added) yielding a spurious
        // event the sidebar would have nothing to reconcile it against.
        guard peers.removeValue(forKey: id) != nil else { return }
        for continuation in deviceEventSubscribers.values {
            continuation.yield(.disconnected(id))
        }
    }

    /// Closes and deregisters every currently connected peer — the
    /// `BridgeServer.stop()` counterpart to `addPeer`/`removePeer`. Without
    /// this, stopping the listener left every already-accepted connection
    /// live and registered here, relaying frames indefinitely even though
    /// `BridgeServer.isRunning` had already gone false.
    public func closeAllPeers() {
        for id in Array(peers.keys) {
            peers[id]?.close()
            removePeer(id)
        }
    }

    /// Ingest one raw text frame from `senderID`. Never throws: a malformed
    /// frame (bad JSON, missing/unknown `type`, non-object `payload`,
    /// oversized) returns `nil` and is dropped without relay. A valid frame
    /// is relayed to every peer other than the sender before this returns.
    @discardableResult
    public func ingest(_ raw: String, from senderID: BridgePeerID) -> BridgeIngestResult? {
        guard let frame = parseBridgeFrame(raw) else { return nil }

        for (id, peer) in peers where id != senderID {
            peer.send(raw)
        }
        if let request = frame.request {
            let deviceLabel = deviceLabeler.label(for: senderID)
            let captured = CapturedRequest(request: request, peerID: senderID, deviceLabel: deviceLabel)
            for continuation in requestSubscribers.values {
                continuation.yield(captured)
            }
        }
        if let control = frame.control, isDeviceToHostCommand(control) {
            for continuation in hostControlSubscribers.values {
                continuation.yield(control)
            }
        }
        if let span = frame.span {
            for continuation in spanSubscribers.values {
                continuation.yield(span)
            }
        }
        if let console = frame.console {
            for continuation in consoleSubscribers.values {
                continuation.yield(console)
            }
        }
        if let storage = frame.storage {
            for continuation in storageSubscribers.values {
                continuation.yield(storage)
            }
        }
        return BridgeIngestResult(
            kind: frame.kind,
            request: frame.request,
            span: frame.span,
            console: frame.console,
            storage: frame.storage
        )
    }

    /// Deliver a host-originated frame to every connected peer — the send
    /// counterpart of `ingest`'s relay: a peer's frame goes to every *other*
    /// peer, while the hub host's own frames (control commands pushed by
    /// `ControlSender`) go to all of them, since the host is not a peer and
    /// has no echo to avoid. Like `ingest`, a frame that does not satisfy
    /// the shallow wire contract is dropped rather than written to anyone.
    /// Returns the number of peers written to.
    @discardableResult
    public func broadcast(_ raw: String) -> Int {
        guard parseBridgeFrame(raw) != nil else { return 0 }
        for peer in peers.values {
            peer.send(raw)
        }
        return peers.count
    }

    deinit {
        for continuation in requestSubscribers.values { continuation.finish() }
        for continuation in hostControlSubscribers.values { continuation.finish() }
        for continuation in spanSubscribers.values { continuation.finish() }
        for continuation in consoleSubscribers.values { continuation.finish() }
        for continuation in storageSubscribers.values { continuation.finish() }
        for continuation in deviceEventSubscribers.values { continuation.finish() }
    }
}
