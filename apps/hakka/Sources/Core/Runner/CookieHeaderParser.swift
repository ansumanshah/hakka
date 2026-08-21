import Foundation

/// One `name=value` pair from a request's `Cookie` header — what a request
/// actually carried, with none of `Set-Cookie`'s attribute grammar.
public struct ParsedCookiePair: Sendable, Equatable, Identifiable, Hashable {
    public var id: String { name }
    public let name: String
    public let value: String

    public init(name: String, value: String) {
        self.name = name
        self.value = value
    }
}

/// One `Set-Cookie` response header, decomposed into its name/value plus
/// every attribute the Cookies tab shows as a structured field rather than
/// making a developer read a raw header string. `expires`/`maxAge` are kept
/// as the response's own raw text — this is a display parser, not a cookie
/// jar, and re-deriving an absolute date from `Max-Age` (or vice versa)
/// would show the reader a value the server never actually sent.
public struct ParsedSetCookie: Sendable, Equatable, Identifiable, Hashable {
    public var id: String { name }
    public let name: String
    public let value: String
    public let expires: String?
    public let maxAge: String?
    public let domain: String?
    public let path: String?
    public let secure: Bool
    public let httpOnly: Bool
    public let sameSite: String?

    public init(
        name: String,
        value: String,
        expires: String? = nil,
        maxAge: String? = nil,
        domain: String? = nil,
        path: String? = nil,
        secure: Bool = false,
        httpOnly: Bool = false,
        sameSite: String? = nil,
    ) {
        self.name = name
        self.value = value
        self.expires = expires
        self.maxAge = maxAge
        self.domain = domain
        self.path = path
        self.secure = secure
        self.httpOnly = httpOnly
        self.sameSite = sameSite
    }
}

/// Parses the `Cookie` and `Set-Cookie` header text carried on a
/// `NetworkRequest` into structured values for the Cookies tab. Deliberately
/// its own grammar rather than a pass through `HTTPCookie` — `NetworkRequest`
/// already hands `Set-Cookie` as one array entry per header instance
/// (`[String: [String]]`), so nothing here needs to split on the comma that
/// HTTP header folding would otherwise use to join repeated headers, and an
/// `Expires` attribute's own comma (`Wed, 21 Oct 2015 07:28:00 GMT`) is
/// never mistaken for a separator. Pure and total: a malformed entry is
/// skipped, never thrown or trapped, so one bad header cannot blank the tab.
public enum CookieHeaderParser {
    /// Every `Cookie` request header, each split into its `name=value`
    /// pairs. A pair with no `=` (or an empty name) is dropped rather than
    /// surfaced as garbage.
    public static func parseCookieHeader(_ values: [String]) -> [ParsedCookiePair] {
        values.flatMap(parsePairs)
    }

    /// Every `Set-Cookie` response header — already one array entry per
    /// header instance — parsed independently. An entry whose first segment
    /// carries no `name=value` is dropped rather than crashing the tab.
    public static func parseSetCookieHeaders(_ values: [String]) -> [ParsedSetCookie] {
        values.compactMap(parseSetCookie)
    }

    /// Convenience over a full request-headers map: finds `Cookie`
    /// case-insensitively, then parses it.
    public static func parseCookieHeader(fromRequestHeaders headers: [String: [String]]) -> [ParsedCookiePair] {
        parseCookieHeader(headerValues("Cookie", in: headers))
    }

    /// Convenience over a full response-headers map: finds every `Set-Cookie`
    /// entry case-insensitively, then parses each independently.
    public static func parseSetCookieHeaders(fromResponseHeaders headers: [String: [String]]) -> [ParsedSetCookie] {
        parseSetCookieHeaders(headerValues("Set-Cookie", in: headers))
    }

    /// Whether a record actually carried a cookie on either side — what the
    /// Cookies tab gates on to appear only when there is something to show.
    /// Header lookup is case-insensitive, matching every other header read
    /// in this codebase (see `GrpcBodyDecode.headerValue`).
    public static func hasCookies(requestHeaders: [String: [String]], responseHeaders: [String: [String]]) -> Bool {
        !headerValues("Cookie", in: requestHeaders).isEmpty || !headerValues("Set-Cookie", in: responseHeaders).isEmpty
    }

    /// Case-insensitive header lookup — `NetworkRequest`'s headers preserve
    /// whatever casing the origin sent, so a fixed-case subscript would miss
    /// a lowercase `set-cookie`.
    private static func headerValues(_ name: String, in headers: [String: [String]]) -> [String] {
        let lower = name.lowercased()
        for (key, values) in headers where key.lowercased() == lower { return values }
        return []
    }

    // MARK: - Cookie (request)

    private static func parsePairs(_ header: String) -> [ParsedCookiePair] {
        splitRespectingQuotes(header, separator: ";").compactMap { segment in
            guard let (name, value) = splitNameValue(segment) else { return nil }
            return ParsedCookiePair(name: name, value: unquote(value))
        }
    }

    // MARK: - Set-Cookie (response)

    private static func parseSetCookie(_ header: String) -> ParsedSetCookie? {
        let segments = splitRespectingQuotes(header, separator: ";")
        guard let first = segments.first, let (name, rawValue) = splitNameValue(first), !name.isEmpty else {
            return nil
        }
        let value = unquote(rawValue)

        var expires: String?
        var maxAge: String?
        var domain: String?
        var path: String?
        var secure = false
        var httpOnly = false
        var sameSite: String?

        for segment in segments.dropFirst() {
            let trimmed = segment.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }

            if let (attrName, attrValue) = splitNameValue(trimmed) {
                switch attrName.lowercased() {
                case "expires": expires = attrValue
                case "max-age": maxAge = attrValue
                case "domain": domain = attrValue
                case "path": path = attrValue
                case "samesite": sameSite = attrValue
                default: break
                }
            } else {
                switch trimmed.lowercased() {
                case "secure": secure = true
                case "httponly": httpOnly = true
                default: break
                }
            }
        }

        return ParsedSetCookie(
            name: name,
            value: value,
            expires: expires,
            maxAge: maxAge,
            domain: domain,
            path: path,
            secure: secure,
            httpOnly: httpOnly,
            sameSite: sameSite,
        )
    }

    // MARK: - Shared grammar

    /// Splits `name=value` on the *first* `=` only — a value legitimately
    /// containing `=` (a base64/JWT cookie value, say) must not get chopped
    /// at the wrong point. Returns nil when there is no `=` at all, or the
    /// trimmed name is empty.
    private static func splitNameValue(_ segment: String) -> (name: String, value: String)? {
        let trimmed = segment.trimmingCharacters(in: .whitespaces)
        guard let equalsIndex = trimmed.firstIndex(of: "=") else { return nil }
        let name = trimmed[trimmed.startIndex..<equalsIndex].trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return nil }
        let value = trimmed[trimmed.index(after: equalsIndex)...].trimmingCharacters(in: .whitespaces)
        return (name, value)
    }

    /// Strips one matching pair of surrounding double quotes, leaving
    /// everything between them untouched (including any `;`/`=` a quoted
    /// value was protecting from the segment split).
    private static func unquote(_ value: String) -> String {
        guard value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") else { return value }
        return String(value.dropFirst().dropLast())
    }

    /// A `;`-splitter that never splits inside a double-quoted span, so a
    /// quoted value carrying `;` or `=` survives as one segment.
    private static func splitRespectingQuotes(_ string: String, separator: Character) -> [String] {
        var parts: [String] = []
        var current = ""
        var inQuotes = false
        for char in string {
            if char == "\"" {
                inQuotes.toggle()
                current.append(char)
            } else if char == separator, !inQuotes {
                parts.append(current)
                current = ""
            } else {
                current.append(char)
            }
        }
        parts.append(current)
        return parts
    }
}
