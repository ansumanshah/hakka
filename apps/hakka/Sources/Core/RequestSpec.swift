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
    /// `operationName` selects which operation runs when `query` defines more
    /// than one (GraphQL requires it in that case); nil for a document with a
    /// single, possibly anonymous, operation. Added in format version 3 —
    /// `operationName` is a trailing `Optional`, so a version-2 file (with no
    /// such key at all) still decodes, reading as nil.
    case graphql(query: String, variables: String, operationName: String?)
    /// Body read from a file at send time (large uploads never enter the collection file).
    case file(path: String, contentType: String)
    /// A gRPC unary message (ADR 0012, phase 1 — raw mode only): `hex` is
    /// hex- or base64-encoded protobuf message bytes exactly as sent on the
    /// wire, decoded by `GrpcMessageBytesCodec`. Only meaningful for a
    /// `grpc://`/`grpcs://` request (see `GrpcURL`) — the request editor's
    /// Body tab offers this case only then, and every other case only
    /// otherwise.
    case grpcMessage(hex: String)

    public var contentTypeHeader: String? {
        switch self {
        case .none: nil
        case let .raw(_, contentType): contentType
        case .form: "application/x-www-form-urlencoded"
        // Boundary is appended by the runner, which owns the actual encoding.
        case .multipart: "multipart/form-data"
        case .graphql: "application/json"
        case let .file(_, contentType): contentType
        // `GrpcRunner` sends this over `GrpcTransport`, never as an HTTP
        // header — this content type is only used for the synthetic
        // `NetworkRequest` display record, matching what a real gRPC
        // request's `Content-Type` looks like on the wire.
        case .grpcMessage: "application/grpc"
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
///
/// `oauth2`'s payload is a single unlabeled `OAuth2Config` rather than
/// `oauth2(accessToken: String)` deliberately: SE-0295's synthesized
/// `Codable` encodes an unlabeled single-value case directly as
/// `{"oauth2": <payload>}`, with no extra wrapper key. That is what makes
/// `OAuth2Config`'s own decode able to recognize and upgrade the pre-1.3
/// shape `{"oauth2": {"accessToken": "..."}}` — see its `init(from:)`.
public enum AuthSpec: Sendable, Codable, Equatable {
    /// Use the parent folder's/collection's auth.
    case inherit
    case none
    case basic(username: String, password: String)
    case bearer(token: String)
    case apiKey(name: String, value: String, placement: APIKeyPlacement)
    case oauth2(OAuth2Config)

    /// Convenience matching the pre-1.3 call shape, used by the curl/Postman
    /// importers and anywhere else a single pre-obtained token is all
    /// there is to model — no client id, no endpoints, nothing to refresh.
    public static func oauth2(accessToken: String) -> AuthSpec {
        .oauth2(OAuth2Config(grant: .staticToken(accessToken: accessToken)))
    }
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
    /// Pre-request/post-response scripts (ADR 0010 phase 4.2). `nil`, not an
    /// empty `RequestScripts`, for a request with no scripting at all — an
    /// `Optional` stored property is what makes Swift's synthesized `Codable`
    /// treat the key as absent-tolerant on decode (`decodeIfPresent`) and
    /// absent-on-encode when nil (`encodeIfPresent`), which is what lets a
    /// pre-existing version-3 `.hakka` file (no `scripts` key at all) keep
    /// decoding without any custom `init(from:)` here.
    public var scripts: RequestScripts?

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
        scripts: RequestScripts? = nil,
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
        self.scripts = scripts
    }
}
