import Foundation
import HakkaCommon

/// The collection model — Hakka's API-client side, the half a network
/// inspector alone can't do.
///
/// Design constraints that shaped this (deliberate, not incidental):
///
/// - **Plain-text, one file per request, diffable.** A collection is a
///   directory of `.hakka` files, not a database or one giant JSON blob.
///   Bruno proved developers want their API collection reviewable in a pull
///   request; a single-file format makes every edit a whole-file diff and
///   every concurrent edit a conflict.
/// - **No secrets in the collection.** Environment *values* live outside the
///   collection tree (see `EnvironmentStore`), because collections get
///   committed and secrets must not.
/// - **Captured requests promote into collections.** `CapturedRequest ->
///   RequestSpec` is a first-class conversion (`RequestSpec.init(captured:)`),
///   which is the thing neither Bruno nor Yaak can do: debug live traffic,
///   then keep the interesting request as a permanent, runnable spec.
///
/// This file holds the collection tree itself (`Collection`, `CollectionNode`,
/// `Folder`). The request payload types live in `RequestSpec.swift`; response
/// assertions and captures live in `Assertion.swift`.
public struct Collection: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    /// Root-level nodes, ordered as displayed.
    public var nodes: [CollectionNode]
    /// Applied to every request in the collection unless the request overrides it.
    public var defaultHeaders: [HeaderPair]
    /// Auth inherited by every request whose own auth is `.inherit`.
    public var auth: AuthSpec
    /// Free-form notes shown in the collection's own detail pane.
    public var notes: String?

    public init(
        id: String = UUID().uuidString,
        name: String,
        nodes: [CollectionNode] = [],
        defaultHeaders: [HeaderPair] = [],
        auth: AuthSpec = .none,
        notes: String? = nil,
    ) {
        self.id = id
        self.name = name
        self.nodes = nodes
        self.defaultHeaders = defaultHeaders
        self.auth = auth
        self.notes = notes
    }
}

/// A node in a collection tree: either a folder or a request.
///
/// Indirect enum rather than a class hierarchy so the whole tree stays a
/// value type — snapshot, diff, and undo all come free, and SwiftUI's
/// change detection works without observation plumbing.
public indirect enum CollectionNode: Sendable, Codable, Equatable, Identifiable {
    case folder(Folder)
    case request(RequestSpec)

    public var id: String {
        switch self {
        case let .folder(f): f.id
        case let .request(r): r.id
        }
    }

    public var name: String {
        switch self {
        case let .folder(f): f.name
        case let .request(r): r.name
        }
    }
}

public struct Folder: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    public var children: [CollectionNode]
    /// Headers merged into every descendant request (collection < folder < request).
    public var headers: [HeaderPair]
    public var auth: AuthSpec

    public init(
        id: String = UUID().uuidString,
        name: String,
        children: [CollectionNode] = [],
        headers: [HeaderPair] = [],
        auth: AuthSpec = .inherit,
    ) {
        self.id = id
        self.name = name
        self.children = children
        self.headers = headers
        self.auth = auth
    }
}
