import Foundation
import Testing
@testable import HakkaCore

@Suite("OAuth2Token expiry")
struct OAuth2TokenTests {
    @Test func neverExpiresWithoutAnExpiresAt() {
        let token = OAuth2Token(accessToken: "t")
        #expect(token.isExpired() == false)
        #expect(token.isExpired(now: Date.distantFuture) == false)
    }

    @Test func notYetExpiredWellBeforeDeadline() {
        let now = Date(timeIntervalSince1970: 1000)
        let token = OAuth2Token(accessToken: "t", expiresAt: now.addingTimeInterval(3600))
        #expect(token.isExpired(now: now, skew: 30) == false)
    }

    @Test func treatedAsExpiredInsideTheSkewWindowEvenThoughNotYetPastDeadline() {
        let now = Date(timeIntervalSince1970: 1000)
        // 10 seconds of real life left, but a 30-second skew buffer means
        // this must already read as expired — refreshing 10 seconds early
        // is the entire point of the buffer.
        let token = OAuth2Token(accessToken: "t", expiresAt: now.addingTimeInterval(10))
        #expect(token.isExpired(now: now, skew: 30) == true)
    }

    @Test func expiredExactlyAtDeadlineWithNoSkew() {
        let now = Date(timeIntervalSince1970: 1000)
        let token = OAuth2Token(accessToken: "t", expiresAt: now)
        #expect(token.isExpired(now: now, skew: 0) == true)
    }

    @Test func expiresAtIsAnchoredToIssuedAtNotToWhenItsChecked() {
        let issuedAt = Date(timeIntervalSince1970: 1000)
        let expiresAt = OAuth2Token.expiresAt(issuedAt: issuedAt, expiresIn: 3600)
        #expect(expiresAt == issuedAt.addingTimeInterval(3600))
    }

    @Test func noExpiresInMeansNoExpiresAt() {
        #expect(OAuth2Token.expiresAt(issuedAt: Date(), expiresIn: nil) == nil)
    }
}
