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

/// A header/query/form entry. `enabled` exists so a user can keep a header
/// around while switching it off — the equivalent of commenting out a line,
/// which every API client needs and a plain dictionary can't express.
public struct HeaderPair: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    public var value: String
    public var enabled: Bool

    public init(id: String = UUID().uuidString, name: String, value: String, enabled: Bool = true) {
        self.id = id
        self.name = name
        self.value = value
        self.enabled = enabled
    }
}

/// The request body. Kept as a closed enum (not a String + contentType pair)
/// so the editor, the code generators, and the runner can't disagree about
/// what a body *is*.
public enum BodySpec: Sendable, Codable, Equatable {
    case none
    /// Raw text with an explicit content type (`application/json`, XML, plain…).
    case raw(text: String, contentType: String)
    /// `application/x-www-form-urlencoded`.
    case form([HeaderPair])
    /// `multipart/form-data`. File parts carry a path, not bytes — a collection
    /// file must stay small and diffable.
    case multipart([MultipartPart])
    /// A GraphQL query plus its variables JSON, sent as a JSON body.
    case graphql(query: String, variables: String)
    /// Body read from a file at send time (large uploads never enter the collection file).
    case file(path: String, contentType: String)

    public var contentTypeHeader: String? {
        switch self {
        case .none: nil
        case let .raw(_, contentType): contentType
        case .form: "application/x-www-form-urlencoded"
        // Boundary is appended by the runner, which owns the actual encoding.
        case .multipart: "multipart/form-data"
        case .graphql: "application/json"
        case let .file(_, contentType): contentType
        }
    }
}

public struct MultipartPart: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    /// Either an inline text value or a file path — never both.
    public var value: String
    public var filePath: String?
    public var contentType: String?
    public var enabled: Bool

    public init(
        id: String = UUID().uuidString,
        name: String,
        value: String = "",
        filePath: String? = nil,
        contentType: String? = nil,
        enabled: Bool = true,
    ) {
        self.id = id
        self.name = name
        self.value = value
        self.filePath = filePath
        self.contentType = contentType
        self.enabled = enabled
    }
}

/// Auth is modeled explicitly rather than as "just set an Authorization
/// header" because the code generators and the redaction rules both need to
/// know which values are credentials.
public enum AuthSpec: Sendable, Codable, Equatable {
    /// Use the parent folder's/collection's auth.
    case inherit
    case none
    case basic(username: String, password: String)
    case bearer(token: String)
    case apiKey(name: String, value: String, placement: APIKeyPlacement)
    /// Pre-obtained token; Hakka does not run an OAuth dance for you.
    case oauth2(accessToken: String)
}

public enum APIKeyPlacement: String, Sendable, Codable, Equatable {
    case header
    case query
}

/// A single runnable request — the unit that gets its own `.hakka` file.
public struct RequestSpec: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    public var method: HttpMethod
    /// May contain `{{variable}}` placeholders; resolved at send time.
    public var url: String
    public var headers: [HeaderPair]
    public var query: [HeaderPair]
    public var body: BodySpec
    public var auth: AuthSpec
    /// Assertions evaluated against the response (the "tests" tab).
    public var assertions: [Assertion]
    /// Values extracted from the response into the environment after a run —
    /// how a login request feeds a token to every later request.
    public var captures: [ResponseCapture]
    public var notes: String?
    /// Seconds; nil uses the app default.
    public var timeout: Double?
    public var followRedirects: Bool

    public init(
        id: String = UUID().uuidString,
        name: String,
        method: HttpMethod = .get,
        url: String = "",
        headers: [HeaderPair] = [],
        query: [HeaderPair] = [],
        body: BodySpec = .none,
        auth: AuthSpec = .inherit,
        assertions: [Assertion] = [],
        captures: [ResponseCapture] = [],
        notes: String? = nil,
        timeout: Double? = nil,
        followRedirects: Bool = true,
    ) {
        self.id = id
        self.name = name
        self.method = method
        self.url = url
        self.headers = headers
        self.query = query
        self.body = body
        self.auth = auth
        self.assertions = assertions
        self.captures = captures
        self.notes = notes
        self.timeout = timeout
        self.followRedirects = followRedirects
    }
}

/// A response assertion. Deliberately declarative (no embedded scripting
/// language): assertions stay diffable, runnable headlessly by the CLI, and
/// safe to execute without a JS sandbox in a native app.
public struct Assertion: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var target: AssertionTarget
    public var op: AssertionOperator
    public var expected: String
    public var enabled: Bool

    public init(
        id: String = UUID().uuidString,
        target: AssertionTarget,
        op: AssertionOperator,
        expected: String,
        enabled: Bool = true,
    ) {
        self.id = id
        self.target = target
        self.op = op
        self.expected = expected
        self.enabled = enabled
    }
}

public enum AssertionTarget: Sendable, Codable, Equatable {
    case status
    case durationMs
    case header(name: String)
    /// Dot/bracket path into a JSON response body, e.g. `data.items[0].id`.
    case jsonPath(String)
    case bodyText
}

public enum AssertionOperator: String, Sendable, Codable, Equatable, CaseIterable {
    case equals
    case notEquals
    case contains
    case notContains
    case matches
    case lessThan
    case greaterThan
    case exists
    case notExists
}

/// Extract a value from a response into an environment variable.
public struct ResponseCapture: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    /// Variable name to write (without braces).
    public var variable: String
    public var source: AssertionTarget
    public var enabled: Bool

    public init(id: String = UUID().uuidString, variable: String, source: AssertionTarget, enabled: Bool = true) {
        self.id = id
        self.variable = variable
        self.source = source
        self.enabled = enabled
    }
}
