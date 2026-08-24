import Foundation
import HakkaCommon
import HakkaCore

/// The subscribe half of `BridgeHub`'s per-channel broadcast — see that
/// file's doc comment for why streams are per-subscription rather than
/// stored. One pair of methods per channel, all the same shape:
/// `subscribeX()` registers a fresh continuation in the matching dictionary
/// declared on `BridgeHub` itself (an extension cannot add stored
/// properties) and returns the `AsyncStream` wrapping it; the paired
/// `unsubscribeX`, installed as that continuation's `onTermination`, removes
/// just that one entry — never another subscriber on the same channel, and
/// never the channel itself. `[weak self]` in each `onTermination` avoids a
/// retain cycle (the continuation, owned by `self`, would otherwise hold a
/// strong closure back to `self`); the `Task` hop is required because
/// `onTermination` can fire off the actor and must not touch actor-isolated
/// state directly.
extension BridgeHub {
    /// Decoded `request` frames paired with sender identity, in ingestion
    /// order — the desktop app's capture store. `TrafficModel.start()`
    /// subscribes fresh every call, including a re-`start()` after a
    /// previous window's subscription was cancelled.
    public func subscribeRequests() -> AsyncStream<CapturedRequest> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<CapturedRequest>.makeStream()
        requestSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeRequests(id) }
        }
        return stream
    }

    private func unsubscribeRequests(_ id: UUID) {
        requestSubscribers.removeValue(forKey: id)
    }

    /// Decoded `control` frames a device sent *to* this host, in ingestion
    /// order — today that means `breakpoint.paused` only, already filtered
    /// through `isDeviceToHostCommand` at `ingest` time.
    public func subscribeHostControls() -> AsyncStream<ControlCommand> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<ControlCommand>.makeStream()
        hostControlSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeHostControls(id) }
        }
        return stream
    }

    private func unsubscribeHostControls(_ id: UUID) {
        hostControlSubscribers.removeValue(forKey: id)
    }

    /// Decoded `span` frames, in ingestion order — the moat-feature
    /// counterpart to `subscribeRequests`.
    public func subscribeSpans() -> AsyncStream<FrameworkSpan> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<FrameworkSpan>.makeStream()
        spanSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeSpans(id) }
        }
        return stream
    }

    private func unsubscribeSpans(_ id: UUID) {
        spanSubscribers.removeValue(forKey: id)
    }

    /// Decoded `console` frames, one array per frame (a frame's payload is
    /// always a batch — see `BridgeFrame.console`).
    public func subscribeConsoleEntries() -> AsyncStream<[LogEntry]> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<[LogEntry]>.makeStream()
        consoleSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeConsoleEntries(id) }
        }
        return stream
    }

    private func unsubscribeConsoleEntries(_ id: UUID) {
        consoleSubscribers.removeValue(forKey: id)
    }

    /// Decoded `storage` frames, one snapshot per frame — snapshot-replace
    /// semantics, see `StorageSnapshot`'s doc comment.
    public func subscribeStorageSnapshots() -> AsyncStream<StorageSnapshot> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<StorageSnapshot>.makeStream()
        storageSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeStorageSnapshots(id) }
        }
        return stream
    }

    private func unsubscribeStorageSnapshots(_ id: UUID) {
        storageSubscribers.removeValue(forKey: id)
    }

    /// Connect/disconnect transitions, in the order `addPeer`/`removePeer`
    /// observe them — the device sidebar's connection signal.
    public func subscribeDeviceEvents() -> AsyncStream<BridgeDeviceEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<BridgeDeviceEvent>.makeStream()
        deviceEventSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeDeviceEvents(id) }
        }
        return stream
    }

    private func unsubscribeDeviceEvents(_ id: UUID) {
        deviceEventSubscribers.removeValue(forKey: id)
    }
}
