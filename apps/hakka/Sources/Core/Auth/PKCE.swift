import CryptoKit
import Foundation
import Security

/// PKCE (RFC 7636) verifier/challenge generation for the authorization-code
/// grant. `S256` only — `plain` exists in the RFC as a fallback for clients
/// that can't hash, which Hakka always can, so offering it would just be an
/// extra way to ship a weaker flow.
public enum PKCE {
    /// RFC 7636 §4.1 unreserved character set: the verifier must be built
    /// from exactly this alphabet, 43-128 characters.
    private static let unreserved = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// A fresh, cryptographically random code verifier. 64 random bytes map
    /// 1:1 to alphabet characters, giving a 64-character verifier — inside
    /// the RFC's mandatory 43-128 range (a 32-character verifier, however
    /// random, is simply an invalid PKCE verifier and every compliant
    /// provider will reject it) and well past its 256-bit-input floor.
    public static func generateVerifier() -> String {
        let bytes = SecureRandom.bytes(count: 64)
        // Map each random byte into the unreserved alphabet by modulus. The
        // alphabet is 66 symbols wide against a 256-value byte, so the
        // rejection-free modulus biases low symbols by a fraction of a
        // percent — irrelevant for a value whose job is uniqueness and
        // unguessability, not uniform sampling.
        return String(bytes.map { unreserved[Int($0) % unreserved.count] })
    }

    /// The S256 challenge for a verifier: `BASE64URL(SHA256(ASCII(verifier)))`,
    /// unpadded, per RFC 7636 §4.2.
    public static func challenge(forVerifier verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Base64URL.encode(Data(digest))
    }
}

/// A cryptographically secure random string, used for PKCE verifiers and
/// the `state` parameter alike — both need to be unguessable, not just
/// unique.
enum SecureRandom {
    static func bytes(count: Int) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed with status \(status)")
        return bytes
    }

    /// A URL-safe random token (used for the OAuth2 `state` parameter):
    /// base64url of 32 random bytes, 43 characters, no padding.
    static func token() -> String {
        Base64URL.encode(Data(bytes(count: 32)))
    }
}

enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
