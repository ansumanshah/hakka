import Foundation
import Testing
@testable import HakkaCore

@Suite("OAuth2ExpiryCountdown")
struct OAuth2ExpiryCountdownTests {
    @Test func roundsUpPartialMinutesSoItNeverReadsAsExpiringNow() {
        let now = Date(timeIntervalSince1970: 1000)
        // 58 minutes and change — the design's own example.
        let countdown = OAuth2ExpiryCountdown(expiresAt: now.addingTimeInterval(58 * 60 + 1), now: now)
        #expect(countdown == .minutes(59))
        #expect(countdown.displayText == "expires in 59 min")
    }

    @Test func exactMinuteBoundaryDoesNotRoundUpAnExtraMinute() {
        let now = Date(timeIntervalSince1970: 1000)
        let countdown = OAuth2ExpiryCountdown(expiresAt: now.addingTimeInterval(60), now: now)
        #expect(countdown == .minutes(1))
    }

    @Test func expiredExactlyAtDeadline() {
        let now = Date(timeIntervalSince1970: 1000)
        #expect(OAuth2ExpiryCountdown(expiresAt: now, now: now) == .expired)
        #expect(OAuth2ExpiryCountdown(expiresAt: now, now: now).displayText == "expired")
    }

    @Test func expiredWellInThePast() {
        let now = Date(timeIntervalSince1970: 1000)
        let countdown = OAuth2ExpiryCountdown(expiresAt: now.addingTimeInterval(-3600), now: now)
        #expect(countdown == .expired)
    }

    @Test func oneSecondLeftStillRoundsUpToOneMinuteNotZero() {
        let now = Date(timeIntervalSince1970: 1000)
        let countdown = OAuth2ExpiryCountdown(expiresAt: now.addingTimeInterval(1), now: now)
        #expect(countdown == .minutes(1))
    }
}
