import Foundation

/// One header as it will actually be sent: name/value already resolved,
/// tagged with whether it carries a credential so generators can redact it
/// without re-deriving that from the header name or the source `AuthSpec`.
public struct EffectiveHeader: Sendable, Equatable {
    public let name: String
    public let value: String
    public let isSecret: Bool

    public init(name: String, value: String, isSecret: Bool) {
        self.name = name
        self.value = value
        self.isSecret = isSecret
    }

    /// The value to paste: `value` verbatim, or a redacted form (scheme
    /// prefix kept, credential dropped) when this header is a credential
    /// and `secrets` asks for `.redacted`.
    public func displayValue(_ secrets: SecretDisplay) -> String {
        guard isSecret, secrets == .redacted else { return value }
        return Redaction.redact(headerValue: value)
    }
}
