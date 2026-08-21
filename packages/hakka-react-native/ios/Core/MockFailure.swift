// @generated — do not edit. Synced from ios/Sources/Common/MockFailure.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - MockFailure
//
// Split out of `MockEngine.swift` to keep files under 200 lines.

/// Platform-neutral transport-error codes for a `failure`-mode rule (see
/// `MockRule.failure`). Mirrors `MockFailureCode` in
/// `packages/hakka-core/src/engine/MockEngine.ts` — the source of truth;
/// read it there for the full cross-runtime mapping table. Maps onto
/// `URLError.Code` for the failure this native engine actually throws (see
/// `HakkaURLProtocol.serveFailureResponse`).
public enum MockFailureCode: String, Sendable, Equatable, CaseIterable {
    case timeout
    case noConnection
    case cannotFindHost
    case cannotConnectToHost
    case connectionLost
    case secureConnectionFailed
    case cancelled
    case unknown

    /// The `URLError.Code` this failure simulates.
    public var urlErrorCode: Int {
        switch self {
        case .timeout: return NSURLErrorTimedOut
        case .noConnection: return NSURLErrorNotConnectedToInternet
        case .cannotFindHost: return NSURLErrorCannotFindHost
        case .cannotConnectToHost: return NSURLErrorCannotConnectToHost
        case .connectionLost: return NSURLErrorNetworkConnectionLost
        case .secureConnectionFailed: return NSURLErrorSecureConnectionFailed
        case .cancelled: return NSURLErrorCancelled
        case .unknown: return NSURLErrorUnknown
        }
    }

    /// Short display label for pickers (`MocksViewForm.swift`) — `rawValue`
    /// is camelCase wire vocabulary, not UI copy.
    public var displayName: String {
        switch self {
        case .timeout: return "Timeout"
        case .noConnection: return "No connection"
        case .cannotFindHost: return "Cannot find host"
        case .cannotConnectToHost: return "Cannot connect"
        case .connectionLost: return "Connection lost"
        case .secureConnectionFailed: return "TLS failure"
        case .cancelled: return "Cancelled"
        case .unknown: return "Unknown"
        }
    }

    /// Human-readable message shared with every reporting call site.
    public var message: String {
        switch self {
        case .timeout: return "Mocked failure: the request timed out"
        case .noConnection: return "Mocked failure: not connected to the internet"
        case .cannotFindHost: return "Mocked failure: cannot find host"
        case .cannotConnectToHost: return "Mocked failure: cannot connect to host"
        case .connectionLost: return "Mocked failure: the network connection was lost"
        case .secureConnectionFailed: return "Mocked failure: secure connection failed"
        case .cancelled: return "Mocked failure: cancelled"
        case .unknown: return "Mocked failure: unknown network error"
        }
    }
}

/// Simulates a transport-level failure — the request never gets a real
/// response — rather than serving `response`. Mirrors `MockFailure` in
/// `MockEngine.ts`. Precedence: `failure` is checked before `block`, which
/// is checked before the rewrite path (`redirectTo`/`modify`), which is
/// checked before a plain mock `response`.
public struct MockFailure: Sendable, Equatable {
    public let code: MockFailureCode

    public init(code: MockFailureCode) {
        self.code = code
    }
}
