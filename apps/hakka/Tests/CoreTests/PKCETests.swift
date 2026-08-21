import Foundation
import Testing
@testable import HakkaCore

/// RFC 7636 Appendix B's worked example — the canonical vector every PKCE
/// implementation is checked against.
@Suite("PKCE")
struct PKCETests {
    @Test func s256ChallengeMatchesRFC7636AppendixBVector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let challenge = PKCE.challenge(forVerifier: verifier)
        #expect(challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func generatedVerifierUsesOnlyTheUnreservedAlphabetAndRFCLength() {
        let verifier = PKCE.generateVerifier()
        #expect(verifier.count >= 43 && verifier.count <= 128)
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        #expect(verifier.unicodeScalars.allSatisfy { allowed.contains($0) })
    }

    @Test func generatedVerifiersAreNotReused() {
        // Two draws colliding on a 32-byte crypto-random source would mean
        // the RNG is broken, not that the test is flaky.
        #expect(PKCE.generateVerifier() != PKCE.generateVerifier())
    }

    @Test func stateTokensAreNotReused() {
        #expect(SecureRandom.token() != SecureRandom.token())
    }
}
