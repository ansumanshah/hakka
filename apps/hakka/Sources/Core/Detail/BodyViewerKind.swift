import Foundation

/// How a captured body is presented in the detail pane. Chosen by
/// `BodyViewerRegistry` from the body's content type and shape; for JSON
/// bodies the viewer also lets the user switch between the two JSON kinds
/// and raw text.
public enum BodyViewerKind: String, Sendable, Equatable {
    /// Pretty-printed, syntax-highlighted JSON.
    case jsonPretty
    /// Collapsible JSON outline whose children materialize on expand.
    case jsonTree
    /// Decoded image bytes rendered through the platform image view.
    case image
    /// Offset/hex/ASCII dump for binary bodies.
    case hex
    /// Monospaced plain text.
    case text
    /// Length-prefixed gRPC / gRPC-Web frames: status, and a schema-less
    /// protobuf field tree per message.
    case grpc
}
