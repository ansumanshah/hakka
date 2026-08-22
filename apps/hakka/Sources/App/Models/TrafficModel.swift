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
    /// Set once, the first time a request ever lands in `requests`, and
    /// never cleared by `clear()` — distinguishes "nothing has arrived yet"
    /// (Artboard 6's first-run pitch, `FirstRunEmptyView`) from "the list
    /// was cleared after traffic already arrived" (the generic "Waiting for
    /// traffic" `EmptyStateView`). A session that's cleared its list has
    /// already seen the SDK connect; re-showing the onboarding pitch there
    /// would be a regression, not a fresh start.
    private(set) var hasEverReceivedTraffic = false
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
    /// The toolbar's "Errors only" quick filter — layered on top of search
    /// and the noise scope in `visibleRequests`, not a rewrite of the search
    /// text, so toggling it off restores whatever the user actually typed.
    var errorsOnly = false
    /// The older half of an open comparison. Set by "Compare with Selected",
    /// which pairs it with `selectedRequestID`; nil closes the sheet.
    var comparisonBaselineID: String?

    /// Injectable (default: the well-known port) so a test can hand in an
    /// ephemeral-port `BridgeServer` instead of fighting every other test
    /// for `bridgeDefaultPort` — same rationale as `noiseScope` below.
    let server: BridgeServer
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
    /// The standing Focus/Noise lens (see the type's doc comment) — a
    /// muted/focused host stays fully captured, `visibleRequests` just
    /// stops showing it.
    /// Injectable so a test can hand in an isolated `UserDefaults` suite.
    /// The default store writes to `.standard`, which means a test that mutes
    /// a host would otherwise persist that mute into the real app AND leak it
    /// into the next test in the same process.
    let noiseScope: NoiseScopeStore
    /// Which columns the table display mode shows, in what order — see the
    /// type's doc comment for why this is a persisted model rather than
    /// view `@State`.
    let columnConfig = TrafficColumnConfigStore()
    /// List (dense, scan-first) or Table (customizable columns,
    /// compare-first) — both read the same `visibleRequests`. Persisted
    /// directly to user defaults rather than routed through a store type:
    /// it is one enum, not a collection with its own invariants to guard.
    /// A stored property (not computed) so `@Observable` actually tracks
    /// reads/writes of it — a computed get/set over `UserDefaults` would be
    /// invisible to Observation and views would never refresh.
    var displayMode: TrafficDisplayMode = TrafficModel.loadDisplayMode() {
        didSet { UserDefaults.standard.set(displayMode.rawValue, forKey: Self.displayModeKey) }
    }
    private static let displayModeKey = "hakka.traffic.displayMode"

    private static func loadDisplayMode() -> TrafficDisplayMode {
        TrafficDisplayMode(rawValue: UserDefaults.standard.string(forKey: displayModeKey) ?? "") ?? .list
    }
    /// Toggled by the header's "Focus Search" command (Cmd-F) — the search
    /// field observes this and grabs keyboard focus each time it changes.
    /// A counter rather than a bool so pressing Cmd-F twice in a row (the
    /// field already focused) still fires an observable change.
    var focusSearchToken = 0
    /// Sends typed control commands; nil until `start()` hands it the hub.
    private(set) var ruleSender: ControlSender?
    /// Which connected device produced each buffered request. See
    /// `DeviceLabelIndex`'s doc comment for why this isn't just a field on
    /// `NetworkRequest`. Same visibility reasoning as `store` above.
    @ObservationIgnored
    var deviceIndex = DeviceLabelIndex()
    /// Every bridge peer seen this session, connection order — the sidebar's
    /// Devices section. Owned by `TrafficModel+Devices.swift`; not
    /// `private(set)` for the same cross-file reason as `deviceIndex` above.
    var devices: [ConnectedDevice] = []
    /// `devices`' index by peer id, to avoid a linear scan per event.
    @ObservationIgnored
    var deviceIndexByPeer: [BridgePeerID: Int] = [:]

    init(noiseScope: NoiseScopeStore = NoiseScopeStore(), server: BridgeServer = BridgeServer()) {
        self.noiseScope = noiseScope
        self.server = server
    }

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
        // Four indefinitely-running consumers of the same hub: captured
        // requests, device-to-host control frames, framework spans, and
        // connect/disconnect events. All four live under one group so they
        // are cancelled together with this task, rather than any of them
        // being an untracked detached `Task` that outlives the scene.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { [traceStore] in
                for await span in hub.spans {
                    await traceStore.addSpan(span)
                }
            }
            group.addTask { await self.consumeHostControls(hub: hub) }
            group.addTask { await self.consumeRequests(hub: hub) }
            group.addTask { await self.consumeDeviceEvents(hub: hub) }
        }
    }

    private func consumeRequests(hub: BridgeHub) async {
        for await captured in hub.requests {
            let request = captured.request
            await store.append(request)
            requests.append(request)
            hasEverReceivedTraffic = true
            deviceIndex.record(requestID: request.id, label: captured.deviceLabel)
            attributeToDevice(peerID: captured.peerID, label: captured.deviceLabel)
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

    /// Parsing and compiling are cached against the search text because
    /// SwiftUI reads a computed property several times per frame, and
    /// compiling means building an `NSRegularExpression` per regex token —
    /// per keystroke, against a buffer of a thousand records, that is enough
    /// to make typing feel slow in a tool whose whole point is not being slow.
    /// `@ObservationIgnored` is load-bearing: this is written *during* a read
    /// of `visibleRequests`, so a tracked property would invalidate the view
    /// that is currently rendering and spin. Not `private`: an extension
    /// can't add a stored property, so `searchMatchedRequests`/
    /// `compiledQuery` live in `TrafficModel+Search.swift` instead and need
    /// to reach this one.
    @ObservationIgnored
    var queryCache: (text: String, query: TrafficQuery, match: @Sendable (NetworkRequest) -> Bool)?

    func request(id: String) -> NetworkRequest? {
        requests.first { $0.id == id }
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
        if !requests.isEmpty { hasEverReceivedTraffic = true }
    }
}
