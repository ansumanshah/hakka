import Foundation

/// Whether a code generator should paste literal credential values or a
/// placeholder — "copy for myself" (`.raw`) vs. "copy for a bug report"
/// (`.redacted`). Callers choose explicitly; there is no silent default,
/// because getting this wrong either leaks a token or ships code that can't
/// authenticate.
public enum SecretDisplay: Sendable, Equatable {
    case raw
    case redacted
}

/// Shared credential-detection rules used by both the header/query builder
/// (`EffectiveRequest`) and the generators that consume it.
enum Redaction {
    static let placeholder = "REDACTED"

    private static let authSchemes = ["Bearer", "Basic", "Digest", "Token", "ApiKey"]

    /// Headers that are credentials by name alone, independent of whether
    /// they came from `AuthSpec` or were typed directly into the editor.
    static func isCredentialHeaderName(_ name: String) -> Bool {
        switch name.lowercased() {
        case "authorization", "cookie", "x-api-key": true
        default: false
        }
    }

    /// Redacts a header value, keeping a recognized auth scheme prefix
    /// (`Bearer`, `Basic`, ...) intact so the pasted code still shows
    /// *which* auth flow is in play — `Authorization: Bearer REDACTED`
    /// reads far better in a bug report than a bare `REDACTED`.
    static func redact(headerValue: String) -> String {
        for scheme in authSchemes {
            guard headerValue.count > scheme.count + 1 else { continue }
            let prefixEnd = headerValue.index(headerValue.startIndex, offsetBy: scheme.count)
            guard headerValue[headerValue.startIndex ..< prefixEnd].caseInsensitiveCompare(scheme) == .orderedSame,
                  headerValue[prefixEnd] == " " else { continue }
            return "\(scheme) \(placeholder)"
        }
        return placeholder
    }
}
