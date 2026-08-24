import Foundation

/// The token-gate half of `BridgeConnection` — split out purely to keep
/// that file under the repo's file-length convention; these are pure
/// functions with no access to `BridgeConnection`'s stored state, called
/// from `handleAssembledMessage`. See `BridgeServerOptions.token`.
extension BridgeConnection {
    /// Checks a first frame `{"token":"<value>"}` against `expected` — the
    /// only shape this gate understands; anything else (a real bridge
    /// frame sent before auth, malformed JSON, a missing/wrong-typed
    /// `token` field) is rejected the same as a wrong token.
    static func isValidAuthFrame(_ raw: String, expecting expected: String) -> Bool {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let provided = object["token"] as? String
        else { return false }
        return constantTimeEquals(provided, expected)
    }

    /// Constant-time compare, mirroring `isTokenValid` in `server.ts`: a
    /// length mismatch is rejected outright rather than padded, which
    /// leaks only the *length* of the secret — an acceptable trade-off for
    /// a local dev tool, same rationale as the TS twin.
    static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let lhs = Array(a.utf8)
        let rhs = Array(b.utf8)
        guard lhs.count == rhs.count else { return false }
        var diff: UInt8 = 0
        for (x, y) in zip(lhs, rhs) { diff |= x ^ y }
        return diff == 0
    }
}
