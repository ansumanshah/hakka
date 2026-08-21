import Foundation

/// Tracks the URLs a request was redirected through, and enforces
/// `followRedirects: false` by declining every redirect — the 3xx response
/// is then returned as `URLSession`'s final response, matching how a client
/// that doesn't follow redirects behaves.
///
/// `@unchecked Sendable`: `NSObject`-derived delegate types can't be actors,
/// but the only stored state is a `let` reference to `RedirectStore`, an
/// actor — every mutation is isolated there, so this has no actual data race.
final class RedirectTrackingDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let followRedirects: Bool
    private let store = RedirectStore()
    private let phaseStore = PhaseStore()

    init(followRedirects: Bool) {
        self.followRedirects = followRedirects
    }

    func redirects() async -> [URL] {
        await store.all()
    }

    func collectedPhases() async -> TransportPhases? {
        await phaseStore.phases()
    }

    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest request: URLRequest,
    ) async -> URLRequest? {
        // A declined redirect never happens — the 3xx becomes the final
        // response — so it must not appear in the recorded chain either.
        guard followRedirects else { return nil }
        if let url = request.url {
            await store.record(url)
        }
        return request
    }

    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        didFinishCollecting metrics: URLSessionTaskMetrics
    ) {
        let phases = TaskPhaseTimestamps.phases(from: metrics)
        Task { await phaseStore.record(phases) }
    }
}

private actor RedirectStore {
    private var urls: [URL] = []

    func record(_ url: URL) {
        urls.append(url)
    }

    func all() -> [URL] {
        urls
    }
}

private actor PhaseStore {
    private var value: TransportPhases?

    func record(_ phases: TransportPhases?) {
        value = phases
    }

    func phases() -> TransportPhases? {
        value
    }
}
