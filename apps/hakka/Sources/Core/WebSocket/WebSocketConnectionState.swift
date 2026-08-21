import Foundation

/// A live connection's lifecycle. The desktop brief requires all four of
/// these to be visible to the user, with the close code surfaced rather
/// than swallowed and disconnect available regardless of which state the
/// connection is in.
public enum WebSocketConnectionState: Sendable, Equatable {
    case idle
    case connecting
    case open(wsProtocol: String?)
    case closed(code: Int)
    case failed(String)

    public var isOpen: Bool {
        if case .open = self { return true }
        return false
    }

    /// `.closed`/`.failed` — the connection has ended and nothing will move
    /// it out of this state without a fresh `connect`.
    public var isTerminal: Bool {
        switch self {
        case .closed, .failed: true
        case .idle, .connecting, .open: false
        }
    }
}

/// A full snapshot of one `WebSocketCaptureSession`, published on every
/// change — same shape as `RuleStore`'s `[RuleEntry]` snapshots, so a
/// `@MainActor` model mirrors it with a plain assignment instead of an
/// actor hop per frame.
public struct WebSocketCaptureSnapshot: Sendable, Equatable {
    public let state: WebSocketConnectionState
    public let frames: [WebSocketFrame]
    /// Frames observed past `WebSocketCaps.perConnectionFrameCount` and not
    /// stored — surfaced so a capped console doesn't read as a quiet
    /// connection when it's actually a busy one that hit the cap.
    public let droppedFrameCount: Int
    public let totalFrameCount: Int

    public static let empty = WebSocketCaptureSnapshot(state: .idle, frames: [], droppedFrameCount: 0, totalFrameCount: 0)

    public init(state: WebSocketConnectionState, frames: [WebSocketFrame], droppedFrameCount: Int, totalFrameCount: Int) {
        self.state = state
        self.frames = frames
        self.droppedFrameCount = droppedFrameCount
        self.totalFrameCount = totalFrameCount
    }
}
