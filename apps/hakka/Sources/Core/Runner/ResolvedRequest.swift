import Foundation
import HakkaCommon

/// A `RequestSpec` fully resolved against its inherited collection/folder
/// context and a `VariableScope`: every `{{variable}}` interpolated, header
/// precedence (collection < folder < request) applied, and auth folded into
/// headers/query. Only ever constructed by `RequestResolver`, which refuses
/// to produce one while any variable is unresolved.
public struct ResolvedRequest: Sendable, Equatable {
    public let requestId: String
    public let name: String
    public let method: HttpMethod
    public let url: URL
    /// Final header set, already deduplicated case-insensitively — collection
    /// defaults, then folder headers outer-to-inner, then the request's own,
    /// then auth, each level overriding a same-named header from before it.
    public let headers: [String: String]
    /// Interpolated body, disabled form/multipart entries dropped. Still a
    /// `BodySpec` rather than raw bytes — encoding (multipart boundaries,
    /// file reads) is `RequestBodyEncoder`'s job at send time, not resolution's.
    public let body: BodySpec
    /// Seconds; `nil` means "use the runner's default".
    public let timeout: TimeInterval?
    public let followRedirects: Bool

    public init(
        requestId: String,
        name: String,
        method: HttpMethod,
        url: URL,
        headers: [String: String],
        body: BodySpec,
        timeout: TimeInterval?,
        followRedirects: Bool,
    ) {
        self.requestId = requestId
        self.name = name
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
        self.timeout = timeout
        self.followRedirects = followRedirects
    }
}
