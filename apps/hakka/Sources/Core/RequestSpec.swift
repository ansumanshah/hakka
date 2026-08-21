import Foundation
import HakkaCommon

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
