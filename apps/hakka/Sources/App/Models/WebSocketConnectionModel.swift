import Foundation
import HakkaCore
import Observation

/// The frame console's model: owns one `WebSocketCaptureSession` at a time
/// (fresh per `connect`) and mirrors its snapshot stream into `@Observable`
/// state — same shape `RulesModel` uses for `RuleStore.changes`. Lives on
/// `AppModel` as its own model rather than folding into
/// `RequestEditorModel`: a socket is a session with many events, not a
/// request with one response, so it never goes through `RequestRunner` or
/// `RunResult` at all.
@MainActor
@Observable
final class WebSocketConnectionModel {
    private(set) var snapshot: WebSocketCaptureSnapshot = .empty
    private(set) var connectError: String?

    private let transport: WebSocketTransport
    private var session: WebSocketCaptureSession?
    private var mirrorTask: Task<Void, Never>?

    init(transport: WebSocketTransport = URLSessionWebSocketTransport()) {
        self.transport = transport
    }

    var state: WebSocketConnectionState { snapshot.state }

    /// Opens a fresh session for `urlString` — a request-editor URL already
    /// screened by `WebSocketURL.isWebSocketURL` before the console shows at
    /// all. Discards any prior connection's frames, matching
    /// `WebSocketCaptureSession.connect`'s own per-connection scoping.
    func connect(urlString: String) {
        mirrorTask?.cancel()
        connectError = nil
        guard let url = URL(string: urlString) else {
            connectError = "Not a valid URL."
            snapshot = .empty
            return
        }
        snapshot = WebSocketCaptureSnapshot(state: .connecting, frames: [], droppedFrameCount: 0, totalFrameCount: 0)
        let session = WebSocketCaptureSession(transport: transport)
        self.session = session
        mirrorTask = Task {
            for await latest in session.changes {
                snapshot = latest
            }
        }
        Task { await session.connect(url: url) }
    }

    /// Always available, per the brief — a no-op when there is nothing to
    /// close, never something the caller has to gate on connection state.
    func disconnect() {
        guard let session else { return }
        Task { await session.disconnect() }
    }

    /// Fire-and-forget by design: a send failure is always
    /// `WebSocketSessionError.notConnected`, which `snapshot.state` already
    /// explains (closed/failed/never opened) — there is nowhere better for
    /// the error to go than the state the composer already reads.
    func send(text: String) {
        guard let session else { return }
        Task { try? await session.send(text: text) }
    }
}
