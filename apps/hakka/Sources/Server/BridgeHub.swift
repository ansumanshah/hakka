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
/// decoded and yielded on `requests` for the desktop app's own capture UI.
///
/// Deliberately does not port `BridgeHub.ts`'s request/span backlog + replay
/// (buffered so a freshly-connected *browser viewer* sees history): the
/// desktop app is the one local consumer of `requests`, not a dashboard other
/// peers connect to inspect, so there is no "late joiner" to replay to.
public actor BridgeHub {
    private var peers: [BridgePeerID: any BridgeRelayPeer] = [:]
    private let requestContinuation: AsyncStream<CapturedRequest>.Continuation
    private let hostControlContinuation: AsyncStream<ControlCommand>.Continuation
    private let spanContinuation: AsyncStream<FrameworkSpan>.Continuation
    private let consoleContinuation: AsyncStream<[LogEntry]>.Continuation
    private let storageContinuation: AsyncStream<StorageSnapshot>.Continuation
    private let deviceEventContinuation: AsyncStream<BridgeDeviceEvent>.Continuation
    /// Assigns "Device N" labels to peers as their frames are first seen —
    /// see `BridgeDeviceLabel.swift` for why this is the honest amount of
    /// identity the hub can offer.
    private var deviceLabeler = BridgeDeviceLabeler()

    /// Decoded `request` frames paired with sender identity, in ingestion
    /// order. One logical consumer (the desktop app's capture store) —
    /// `AsyncStream` does not fan out to multiple concurrent iterators.
    /// `nonisolated`: the stream itself is an immutable, `Sendable` handle
    /// with its own internal thread-safe buffering, so consuming it needs
    /// no actor hop.
    public nonisolated let requests: AsyncStream<CapturedRequest>

    /// Decoded `control` frames a device sent *to* this host, in ingestion
    /// order — today that means `breakpoint.paused` only. Filtered through
    /// `isDeviceToHostCommand` (HakkaCommon, the single source of truth for
    /// the contract's direction split) rather than yielding every control
    /// frame: a host-authored command relayed back by some misbehaving peer
    /// must never be mistaken here for a device reporting a pause. One
    /// logical consumer, same `nonisolated` reasoning as `requests`.
    public nonisolated let hostControls: AsyncStream<ControlCommand>

    /// Decoded `span` frames, in ingestion order — the moat-feature
    /// counterpart to `requests`. Same single-consumer contract.
    public nonisolated let spans: AsyncStream<FrameworkSpan>

    /// Decoded `console` frames, one array per frame (a frame's payload is
    /// always a batch, even for a single entry — see `BridgeFrame.console`).
    /// Same single-consumer contract as `requests`/`spans`. No backlog/replay
    /// (unlike TS's `BridgeHub`, which buffers spans for a browser viewer):
    /// this hub has no late-joining dashboard to replay to, only the app's
    /// own Logs panel, which is either already listening or has missed a
    /// live moment permanently — matching `LogEntry`'s own nature.
    public nonisolated let consoleEntries: AsyncStream<[LogEntry]>

    /// Decoded `storage` frames, one snapshot per frame — snapshot-replace
    /// semantics (see `StorageSnapshot`'s doc comment), so the Storage panel
    /// only ever needs the latest value per store name, which it keeps for
    /// itself; the hub does not buffer for replay (same reasoning as
    /// `consoleEntries` above — no late-joining dashboard here).
    public nonisolated let storageSnapshots: AsyncStream<StorageSnapshot>

    /// Connect/disconnect transitions, in the order `addPeer`/`removePeer`
    /// observe them — the device sidebar's connection signal. Same
    /// single-consumer, `nonisolated` reasoning as the streams above.
    public nonisolated let deviceEvents: AsyncStream<BridgeDeviceEvent>

    public init() {
        var continuation: AsyncStream<CapturedRequest>.Continuation?
        requests = AsyncStream { continuation = $0 }
        requestContinuation = continuation!

        var controlContinuation: AsyncStream<ControlCommand>.Continuation?
        hostControls = AsyncStream { controlContinuation = $0 }
        hostControlContinuation = controlContinuation!

        var spanCont: AsyncStream<FrameworkSpan>.Continuation?
        spans = AsyncStream { spanCont = $0 }
        spanContinuation = spanCont!

        var consoleCont: AsyncStream<[LogEntry]>.Continuation?
        consoleEntries = AsyncStream { consoleCont = $0 }
        consoleContinuation = consoleCont!

        var storageCont: AsyncStream<StorageSnapshot>.Continuation?
        storageSnapshots = AsyncStream { storageCont = $0 }
        storageContinuation = storageCont!

        var deviceEventCont: AsyncStream<BridgeDeviceEvent>.Continuation?
        deviceEvents = AsyncStream { deviceEventCont = $0 }
        deviceEventContinuation = deviceEventCont!
    }

    public var peerCount: Int { peers.count }

    public func addPeer(_ peer: any BridgeRelayPeer) {
        peers[peer.id] = peer
        deviceEventContinuation.yield(.connected(peer.id))
    }

    public func removePeer(_ id: BridgePeerID) {
        // Only a peer that was actually registered can meaningfully
        // disconnect — guards against a duplicate `.failed`/`.cancelled`
        // delivery (or an id that was never added) yielding a spurious
        // event the sidebar would have nothing to reconcile it against.
        guard peers.removeValue(forKey: id) != nil else { return }
        deviceEventContinuation.yield(.disconnected(id))
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
            requestContinuation.yield(CapturedRequest(request: request, peerID: senderID, deviceLabel: deviceLabel))
        }
        if let control = frame.control, isDeviceToHostCommand(control) {
            hostControlContinuation.yield(control)
        }
        if let span = frame.span {
            spanContinuation.yield(span)
        }
        if let console = frame.console {
            consoleContinuation.yield(console)
        }
        if let storage = frame.storage {
            storageContinuation.yield(storage)
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
        requestContinuation.finish()
        hostControlContinuation.finish()
        spanContinuation.finish()
        consoleContinuation.finish()
        storageContinuation.finish()
        deviceEventContinuation.finish()
    }
}
