import Foundation
import HakkaCommon
import HakkaCore
import HakkaServer
import Observation

/// Owns the bridge hub that live devices connect to and a local mirror of
/// its capture stream for SwiftUI. `TrafficStore` (an actor) stays the
/// source of truth for stats/query; `requests` is a plain `@Observable`
/// array kept in the same order so list rendering never awaits.
@MainActor
@Observable
final class TrafficModel {
    private(set) var requests: [NetworkRequest] = []
    private(set) var stats = TrafficStats(count: 0, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0)
    private(set) var isRunning = false
    private(set) var boundPort: UInt16?
    var selectedRequestID: String?
    /// A permanent failure to start the bridge. Set once and never cleared by
    /// anything else — the header reports it in place of a status, and a
    /// transient file-operation message must not overwrite it into "Starting…",
    /// which reads as a state that will resolve on its own when live capture is
    /// in fact dead.
    private(set) var startupError: String?
    /// Transient feedback from an import or export. Separate from
    /// `startupError` precisely so clearing one cannot erase the other.
    var lastError: String?
    /// Raw search-bar text. Parsed on read rather than stored as a compiled
    /// query so a keystroke never has to round-trip through the store actor.
    var searchText = ""
    /// The older half of an open comparison. Set by "Compare with Selected",
    /// which pairs it with `selectedRequestID`; nil closes the sheet.
    var comparisonBaselineID: String?

    let server = BridgeServer()
    /// Internal, not `private`: `TrafficModel+Session.swift`'s extension
    /// needs it too, and an extension in another file can't see `private`.
    let store = TrafficStore()
    /// Cross-target trace correlation (ADR 0001) — joins requests and
    /// `hakka-node` framework spans by `correlationId`/`traceId`. Read by
    /// `Views/Trace/TraceWaterfallView` via `TraceModel`.
    let traceStore = TraceStore()
    /// The authored rules pushed to devices over the bridge.
    let rules = RuleStore()
    /// Breakpoint pauses reported *by* devices, waiting on this desktop.
    let pauses = PauseStore()
    /// Sends typed control commands; nil until `start()` hands it the hub.
    private(set) var ruleSender: ControlSender?
    /// Which connected device produced each buffered request. See
    /// `DeviceLabelIndex`'s doc comment for why this isn't just a field on
    /// `NetworkRequest`. Same visibility reasoning as `store` above.
    @ObservationIgnored
    var deviceIndex = DeviceLabelIndex()

    /// Starts the bridge listener, then consumes its request stream for the
    /// lifetime of the calling task — meant to be driven by a SwiftUI
    /// `.task` at the app root, not spawned as a detached `Task`.
    func start() async {
        guard !isRunning else { return }
        do {
            try await server.start()
            isRunning = true
            boundPort = await server.boundPort
            startupError = nil
        } catch {
            startupError = "Bridge server failed to start: \(error.localizedDescription)"
            return
        }
        let hub = await server.hub
        ruleSender = ControlSender(hub: hub)
        // Three indefinitely-running consumers of the same hub: captured
        // requests, device-to-host control frames, and framework spans. All
        // three live under one group so they are cancelled together with
        // this task, rather than any of them being an untracked detached
        // `Task` that outlives the scene.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { [traceStore] in
                for await span in hub.spans {
                    await traceStore.addSpan(span)
                }
            }
            group.addTask { await self.consumeHostControls(hub: hub) }
            group.addTask { await self.consumeRequests(hub: hub) }
        }
    }

    private func consumeRequests(hub: BridgeHub) async {
        for await captured in hub.requests {
            let request = captured.request
            await store.append(request)
            requests.append(request)
            deviceIndex.record(requestID: request.id, label: captured.deviceLabel)
            if requests.count > TrafficStore.defaultCapacity {
                let overflow = requests.count - TrafficStore.defaultCapacity
                deviceIndex.evict(requestIDs: requests.prefix(overflow).map(\.id))
                requests.removeFirst(overflow)
            }
            await countRuleHits(for: request)
            stats = await store.stats()
            await traceStore.addRequest(request)
        }
    }

    /// Feeds every device -> host control frame (today: `breakpoint.paused`
    /// only — `BridgeHub.hostControls` already filtered to that direction)
    /// into `pauses`. A command that fails to convert to `PendingPause` is
    /// dropped rather than trusted, matching `PendingPause.init?(command:)`'s
    /// own defensiveness.
    private func consumeHostControls(hub: BridgeHub) async {
        for await command in hub.hostControls {
            guard let pause = PendingPause(command: command) else { continue }
            await pauses.ingest(pause)
        }
    }

    /// Which device produced `requestID`'s row, or nil for a request the
    /// bridge never attributed (e.g. one restored from an imported session).
    func deviceLabel(for requestID: String) -> BridgeDeviceLabel? {
        deviceIndex[requestID]
    }

    /// Delivers a control command to every connected device, returning the
    /// peer count. Throws the wire taxonomy — callers surface it, never
    /// swallow it.
    @discardableResult
    func send(_ command: ControlCommand) async throws -> Int {
        guard let ruleSender else { return 0 }
        return try await ruleSender.send(command)
    }

    /// Counts observed matches against every enabled rule — the wire is
    /// fire-and-forget with no feedback frames, so live hit counts come from
    /// the desktop watching its own captured traffic. Matching mirrors the
    /// device engines (see `RuleMatcher`).
    private func countRuleHits(for request: NetworkRequest) async {
        for entry in await rules.rules() where RuleMatcher.matches(entry, url: request.url, method: request.method.rawValue) {
            await rules.recordHit(id: entry.id)
        }
    }

    /// `requests` filtered and sorted by `searchText`, newest first when the
    /// query names no sort of its own. Empty search returns the buffer
    /// unchanged, so the common case pays nothing.
    var visibleRequests: [NetworkRequest] {
        let trimmed = searchText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return requests.reversed() }

        let compiled = compiledQuery(for: trimmed)
        var matched = requests.filter(compiled.match)
        // `device:` has no reach into `TrafficQueryCompiler` — the compiler
        // works over a bare `NetworkRequest`, which carries no device
        // identity (see `DeviceLabelIndex`), so the model applies this term
        // itself using its own `deviceIndex`.
        if let device = compiled.query.device {
            matched = matched.filter { request in
                let matches = (deviceIndex[request.id] ?? "").lowercased().contains(device)
                return matches != compiled.query.deviceNegate
            }
        }
        guard let field = compiled.query.sort else { return matched.reversed() }
        return TrafficSort.sort(matched, field: field, order: compiled.query.order)
    }

    /// Parsing and compiling are cached against the search text because
    /// SwiftUI reads a computed property several times per frame, and
    /// compiling means building an `NSRegularExpression` per regex token —
    /// per keystroke, against a buffer of a thousand records, that is enough
    /// to make typing feel slow in a tool whose whole point is not being slow.
    /// `@ObservationIgnored` is load-bearing: this is written *during* a read
    /// of `visibleRequests`, so a tracked property would invalidate the view
    /// that is currently rendering and spin.
    @ObservationIgnored
    private var queryCache: (text: String, query: TrafficQuery, match: @Sendable (NetworkRequest) -> Bool)?

    private func compiledQuery(for text: String) -> (query: TrafficQuery, match: @Sendable (NetworkRequest) -> Bool) {
        if let cached = queryCache, cached.text == text { return (cached.query, cached.match) }
        let query = TrafficQueryParser.parse(text)
        let match = TrafficQueryCompiler.compile(query)
        queryCache = (text, query, match)
        return (query, match)
    }

    func request(id: String) -> NetworkRequest? {
        requests.first { $0.id == id }
    }

    /// The pair to compare, oldest first, or nil when no comparison is open.
    /// Ordered by arrival rather than by which row was right-clicked, so the
    /// diff always reads "what changed since", not "what changed backwards".
    var comparison: (before: NetworkRequest, after: NetworkRequest)? {
        guard let baselineID = comparisonBaselineID,
              let selectedID = selectedRequestID,
              baselineID != selectedID,
              let baselineIndex = requests.firstIndex(where: { $0.id == baselineID }),
              let selectedIndex = requests.firstIndex(where: { $0.id == selectedID })
        else { return nil }
        return baselineIndex < selectedIndex
            ? (requests[baselineIndex], requests[selectedIndex])
            : (requests[selectedIndex], requests[baselineIndex])
    }

    func clear() async {
        await store.clear()
        requests = []
        deviceIndex.removeAll()
        stats = await store.stats()
        selectedRequestID = nil
        comparisonBaselineID = nil
    }

    /// Replaces the mirrored buffer wholesale. `requests`/`stats` stay
    /// `private(set)` so nothing outside this type can drift them from
    /// `store`'s truth by accident; `TrafficModel+Session.swift` (session
    /// import, which legitimately needs to replace the whole buffer) goes
    /// through this rather than getting its own setter access.
    func setBuffer(_ requests: [NetworkRequest], stats: TrafficStats) {
        self.requests = requests
        self.stats = stats
    }
}
