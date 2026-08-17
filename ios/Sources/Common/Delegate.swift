import Foundation

/// Protocol for receiving captured network requests.
public protocol HakkaDelegate: AnyObject, Sendable {
    /// Called when a network request has been fully captured.
    func hakkaDidCapture(_ request: NetworkRequest)
}

/// Closure-based alternative to `HakkaDelegate`.
public typealias HakkaRequestHandler = @Sendable (NetworkRequest) -> Void
