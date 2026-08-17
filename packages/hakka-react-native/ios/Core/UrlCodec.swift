// @generated — do not edit. Synced from ios/Sources/Common/UrlCodec.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - URL encode/decode helpers

/// URL encode/decode helpers for the Hakka inspector display toggle.
/// Mirrors `hakka-core`'s `urlCodec.ts` semantics (`isUrlEncoded` / `decodeUrl` / `encodeUrl`)
/// so the Decoded/Raw toggle behaves identically across web, RN, and iOS.
public enum HakkaUrlCodec {

    /// Returns true if the string contains at least one percent-encoded sequence (%XX).
    public static func isUrlEncoded(_ string: String) -> Bool {
        string.range(of: #"%[0-9A-Fa-f]{2}"#, options: .regularExpression) != nil
    }

    /// Decode a percent-encoded string for human-readable display.
    /// Falls back to the original string if decoding fails (e.g. malformed
    /// sequences like `%GG`) — same fail-open behavior as core's `decodeUrl`.
    public static func decodeUrl(_ string: String) -> String {
        string.removingPercentEncoding ?? string
    }

    /// Re-encode a decoded string so reserved characters are percent-escaped,
    /// for the Raw side of the display toggle. Idempotent on already-encoded
    /// strings (mirrors core's `encodeUrl`: skip if `%XX` sequences are present).
    public static func encodeUrl(_ string: String) -> String {
        if isUrlEncoded(string) { return string }
        // RFC 3986 unreserved + sub-delimiters + structural chars, left unescaped.
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~!$&'()*+,;=:@/%?#[]")
        return string.addingPercentEncoding(withAllowedCharacters: allowed) ?? string
    }
}
