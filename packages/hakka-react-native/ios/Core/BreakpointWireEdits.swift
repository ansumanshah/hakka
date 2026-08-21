// @generated — do not edit. Synced from ios/Sources/Common/BreakpointWireEdits.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - Wire-only breakpoint-pause types
//
// These mirror `BreakpointPausedRequest` / `BreakpointPausedResponse` /
// `BreakpointRequestEdits` / `BreakpointResponseEdits` in
// `packages/hakka-core/src/engine/control.ts`. They are distinct from
// `PausedRequest` / `PausedResponse` (`BreakpointEngine.swift`) because the
// wire "edits" shapes are all-optional (every field means "keep original if
// absent" — Swift has no `Partial<T>`), and the "paused" snapshot shapes
// pin their own required/optional split (`response.body` is always present;
// `request.body` may be absent) independent of the local engine's types.

/// The paused request's context — present on every `breakpoint.paused` frame
/// regardless of phase.
public struct BreakpointPausedRequestSnapshot: Sendable, Equatable {
    public var url: String
    public var method: String
    public var headers: [String: String]
    public var body: String?

    public init(url: String, method: String, headers: [String: String], body: String? = nil) {
        self.url = url
        self.method = method
        self.headers = headers
        self.body = body
    }
}

/// The paused response snapshot — present only when `phase` is `.response`.
/// `body` is required (not optional): it mirrors `PausedResponse.body`,
/// which is always a string (already read from the real response before
/// pausing), never absent.
public struct BreakpointPausedResponseSnapshot: Sendable, Equatable {
    public var status: Int
    public var headers: [String: String]
    public var body: String

    public init(status: Int, headers: [String: String], body: String) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}

/// Edits to apply to a request-phase pause on resume. All fields optional — absent means "keep original".
public struct BreakpointRequestEdits: Sendable, Equatable {
    public var url: String?
    public var method: String?
    public var headers: [String: String]?
    public var body: String?

    public init(url: String? = nil, method: String? = nil, headers: [String: String]? = nil, body: String? = nil) {
        self.url = url
        self.method = method
        self.headers = headers
        self.body = body
    }
}

/// Edits to apply to a response-phase pause on resume. All fields optional — absent means "keep original".
public struct BreakpointResponseEdits: Sendable, Equatable {
    public var status: Int?
    public var headers: [String: String]?
    public var body: String?

    public init(status: Int? = nil, headers: [String: String]? = nil, body: String? = nil) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}
