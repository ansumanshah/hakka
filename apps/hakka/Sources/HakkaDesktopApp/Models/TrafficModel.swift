import HakkaCommon
import HakkaDesktopCore
import HakkaDesktopServer
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
    var lastError: String?
    /// Raw search-bar text. Parsed on read rather than stored as a compiled
    /// query so a keystroke never has to round-trip through the store actor.
    var searchText = ""

    let server = BridgeServer()
    private let store = TrafficStore()

    /// Starts the bridge listener, then consumes its request stream for the
    /// lifetime of the calling task — meant to be driven by a SwiftUI
    /// `.task` at the app root, not spawned as a detached `Task`.
    func start() async {
        guard !isRunning else { return }
        do {
            try await server.start()
            isRunning = true
            boundPort = await server.boundPort
            lastError = nil
        } catch {
            lastError = "Bridge server failed to start: \(error.localizedDescription)"
            return
        }
        for await request in await server.hub.requests {
            await store.append(request)
            requests.append(request)
            if requests.count > TrafficStore.defaultCapacity {
                requests.removeFirst(requests.count - TrafficStore.defaultCapacity)
            }
            stats = await store.stats()
        }
    }

    /// `requests` filtered and sorted by `searchText`, newest first when the
    /// query names no sort of its own. Empty search returns the buffer
    /// unchanged, so the common case pays nothing.
    var visibleRequests: [NetworkRequest] {
        let trimmed = searchText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return requests.reversed() }

        let query = TrafficQueryParser.parse(trimmed)
        let matched = requests.filter(TrafficQueryCompiler.compile(query))
        guard let field = query.sort else { return matched.reversed() }
        return TrafficSort.sort(matched, field: field, order: query.order)
    }

    func request(id: String) -> NetworkRequest? {
        requests.first { $0.id == id }
    }

    func clear() async {
        await store.clear()
        requests = []
        stats = await store.stats()
    }
}
