import Foundation
import HakkaCommon

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
}

/// Outcome of ingesting one raw frame — returned so callers/tests can
/// observe what happened without re-parsing.
public struct BridgeIngestResult: Sendable, Equatable {
    public let kind: BridgeFrameKind
    /// Set only for `.request` frames whose payload decoded into
    /// `NetworkRequest` — see `BridgeFrame.request`.
    public let request: NetworkRequest?
}

/// Transport-agnostic core of the desktop bridge hub — the Swift mirror of
/// `packages/hakka-bridge/src/BridgeHub.ts`'s relay behavior. Parses each raw
/// frame with `parseBridgeFrame`; a frame that parses is relayed verbatim to
/// every OTHER connected peer regardless of kind (`server.ts`'s message
/// handler relays `request`/`span`/`control` alike — this hub matches that
/// rather than special-casing `request` out), and `.request` frames are also
/// decoded and yielded on `requests` for the desktop app's own capture UI.
///
/// Deliberately does not port `BridgeHub.ts`'s request/span backlog + replay
/// (buffered so a freshly-connected *browser viewer* sees history): the
/// desktop app is the one local consumer of `requests`, not a dashboard other
/// peers connect to inspect, so there is no "late joiner" to replay to.
public actor BridgeHub {
    private var peers: [BridgePeerID: any BridgeRelayPeer] = [:]
    private let requestContinuation: AsyncStream<NetworkRequest>.Continuation

    /// Decoded `request` frames, in ingestion order. One logical consumer
    /// (the desktop app's capture store) — `AsyncStream` does not fan out to
    /// multiple concurrent iterators. `nonisolated`: the stream itself is an
    /// immutable, `Sendable` handle with its own internal thread-safe
    /// buffering, so consuming it needs no actor hop.
    public nonisolated let requests: AsyncStream<NetworkRequest>

    public init() {
        var continuation: AsyncStream<NetworkRequest>.Continuation?
        requests = AsyncStream { continuation = $0 }
        requestContinuation = continuation!
    }

    public var peerCount: Int { peers.count }

    public func addPeer(_ peer: any BridgeRelayPeer) {
        peers[peer.id] = peer
    }

    public func removePeer(_ id: BridgePeerID) {
        peers.removeValue(forKey: id)
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
            requestContinuation.yield(request)
        }
        return BridgeIngestResult(kind: frame.kind, request: frame.request)
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
        requestContinuation.finish()
    }
}
