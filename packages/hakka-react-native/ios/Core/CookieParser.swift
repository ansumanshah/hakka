// @generated — do not edit. Synced from ios/Sources/Common/CookieParser.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - Cookie parsing utilities
//
// Mirrors android/hakka-common/.../CookieParser.kt and
// packages/hakka-core/src/utils/cookies.ts.
//
// Two entry points:
//   - parseRequestCookies(_:) — parses a `Cookie:` request header into name/value pairs.
//   - parseSetCookies(_:)     — parses `Set-Cookie:` response header values into
//                               ParsedCookie objects with full attributes.
//
// Used for DISPLAY only. Cookies remain in the redacted NetworkRequest headers and HAR export.

// MARK: - RequestCookie

/// A name/value pair from a `Cookie:` request header.
public struct RequestCookie: Sendable, Equatable {
    public let name: String
    public let value: String

    public init(name: String, value: String) {
        self.name = name
        self.value = value
    }
}

// MARK: - ParsedCookie

/// A fully parsed `Set-Cookie:` response cookie with optional attributes.
/// Mirrors `ParsedCookie` in packages/hakka-core/src/utils/cookies.ts.
public struct ParsedCookie: Sendable, Equatable {

    /// SameSite policy values.
    public enum SameSite: String, Sendable, Equatable {
        case strict = "Strict"
        case lax = "Lax"
        case none = "None"
    }

    public let name: String
    public let value: String
    public let domain: String?
    public let path: String?
    /// Raw `Expires` attribute string (e.g. "Wed, 09 Jun 2021 10:18:14 GMT").
    public let expires: String?
    /// `Max-Age` attribute in seconds, or nil if absent.
    public let maxAge: Int64?
    public let httpOnly: Bool
    public let secure: Bool
    public let sameSite: SameSite?

    public init(
        name: String,
        value: String,
        domain: String? = nil,
        path: String? = nil,
        expires: String? = nil,
        maxAge: Int64? = nil,
        httpOnly: Bool = false,
        secure: Bool = false,
        sameSite: SameSite? = nil
    ) {
        self.name = name
        self.value = value
        self.domain = domain
        self.path = path
        self.expires = expires
        self.maxAge = maxAge
        self.httpOnly = httpOnly
        self.secure = secure
        self.sameSite = sameSite
    }
}

// MARK: - Public API

/// Parse a `Cookie:` request header value into name/value pairs.
/// Splits on `;`, trims whitespace, splits on the first `=`.
public func parseRequestCookies(_ cookieHeader: String?) -> [RequestCookie] {
    guard let cookieHeader, !cookieHeader.trimmingCharacters(in: .whitespaces).isEmpty else {
        return []
    }
    return cookieHeader
        .split(separator: ";")
        .compactMap { rawPart -> RequestCookie? in
            let part = rawPart.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !part.isEmpty else { return nil }
            if let eqIdx = part.firstIndex(of: "=") {
                let name = part[..<eqIdx].trimmingCharacters(in: .whitespacesAndNewlines)
                let value = part[part.index(after: eqIdx)...].trimmingCharacters(in: .whitespacesAndNewlines)
                return RequestCookie(name: name, value: value)
            } else {
                return RequestCookie(name: part, value: "")
            }
        }
}

/// Parse a list of `Set-Cookie:` header values into `ParsedCookie` objects.
/// Accepts one string per header occurrence (multi-value safe).
public func parseSetCookies(_ setCookieValues: [String]) -> [ParsedCookie] {
    setCookieValues.map { parseSingleSetCookie($0) }
}

// MARK: - Private parsing

private func parseSingleSetCookie(_ line: String) -> ParsedCookie {
    let parts = line.split(separator: ";", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

    // First segment is the name=value pair
    let rawNameVal = parts.first ?? ""
    let attrParts = parts.dropFirst()

    let (name, value): (String, String) = {
        if let eqIdx = rawNameVal.firstIndex(of: "=") {
            let n = rawNameVal[..<eqIdx].trimmingCharacters(in: .whitespacesAndNewlines)
            let v = rawNameVal[rawNameVal.index(after: eqIdx)...].trimmingCharacters(in: .whitespacesAndNewlines)
            return (n, v)
        } else {
            return (rawNameVal.trimmingCharacters(in: .whitespacesAndNewlines), "")
        }
    }()

    var domain: String?
    var path: String?
    var expires: String?
    var maxAge: Int64?
    var httpOnly = false
    var secure = false
    var sameSite: ParsedCookie.SameSite?

    for attr in attrParts where !attr.isEmpty {
        if let eqIdx = attr.firstIndex(of: "=") {
            let key = attr[..<eqIdx].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let val = attr[attr.index(after: eqIdx)...].trimmingCharacters(in: .whitespacesAndNewlines)
            switch key {
            case "domain":  domain = val
            case "path":    path = val
            case "expires": expires = val
            case "max-age": maxAge = Int64(val)
            case "samesite":
                if let parsed = ParsedCookie.SameSite(rawValue: val.capitalized) {
                    sameSite = parsed
                } else if val.lowercased() == "none" {
                    sameSite = ParsedCookie.SameSite.none
                }
            default: break
            }
        } else {
            switch attr.lowercased() {
            case "httponly": httpOnly = true
            case "secure":   secure = true
            default: break
            }
        }
    }

    return ParsedCookie(
        name: name,
        value: value,
        domain: domain,
        path: path,
        expires: expires,
        maxAge: maxAge,
        httpOnly: httpOnly,
        secure: secure,
        sameSite: sameSite
    )
}
