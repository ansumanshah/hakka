import Testing
import Foundation
@testable import HakkaCommon

// MARK: - ThrottleEngine Tests

/// Unit tests for ThrottleEngine: profile selection, latency values per profile,
/// and the byte-drip delay math. Timing behavior (actual sleep) needs device QA.
@Suite("ThrottleEngine", .serialized)
struct ThrottleEngineTests {

    // Each test uses a fresh instance — never touches the shared singleton.
    private func freshEngine() -> ThrottleEngine {
        ThrottleEngine()
    }

    // MARK: - Default state

    @Test func defaultProfileIsNone() {
        let engine = freshEngine()
        #expect(engine.config.profile == .none)
    }

    @Test func defaultIsNotActive() {
        let engine = freshEngine()
        #expect(engine.isActive == false)
    }

    @Test func defaultIsNotOffline() {
        let engine = freshEngine()
        #expect(engine.isOffline == false)
    }

    @Test func defaultLatencyIsZero() {
        let engine = freshEngine()
        #expect(engine.config.latencyMs == 0)
    }

    @Test func defaultDownloadKbpsIsZero() {
        let engine = freshEngine()
        #expect(engine.config.downloadKbps == 0)
    }

    // MARK: - Profile selection: none

    @Test func setNoneResetsToZeroOverhead() {
        let engine = freshEngine()
        engine.setProfile(.fast3g)
        engine.setProfile(.none)
        #expect(engine.config.profile == .none)
        #expect(engine.config.latencyMs == 0)
        #expect(engine.config.downloadKbps == 0)
        #expect(engine.isActive == false)
    }

    // MARK: - Profile selection: fast-3g

    @Test func fast3gProfileValues() {
        let engine = freshEngine()
        engine.setProfile(.fast3g)
        #expect(engine.config.profile == .fast3g)
        #expect(engine.config.latencyMs == 150)
        #expect(engine.config.downloadKbps == 1500)
        #expect(engine.isActive == true)
        #expect(engine.isOffline == false)
    }

    // MARK: - Profile selection: slow-3g

    @Test func slow3gProfileValues() {
        let engine = freshEngine()
        engine.setProfile(.slow3g)
        #expect(engine.config.profile == .slow3g)
        #expect(engine.config.latencyMs == 400)
        #expect(engine.config.downloadKbps == 400)
        #expect(engine.isActive == true)
        #expect(engine.isOffline == false)
    }

    // MARK: - Profile selection: edge

    @Test func edgeProfileValues() {
        let engine = freshEngine()
        engine.setProfile(.edge)
        #expect(engine.config.profile == .edge)
        #expect(engine.config.latencyMs == 250)
        #expect(engine.config.downloadKbps == 240)
        #expect(engine.isActive == true)
        #expect(engine.isOffline == false)
    }

    // MARK: - Profile selection: offline

    @Test func offlineProfileValues() {
        let engine = freshEngine()
        engine.setProfile(.offline)
        #expect(engine.config.profile == .offline)
        #expect(engine.config.latencyMs == 0)
        #expect(engine.config.downloadKbps == 0)
        #expect(engine.isActive == true)
        #expect(engine.isOffline == true)
    }

    // MARK: - Profile switching

    @Test func switchingProfilesUpdatesConfig() {
        let engine = freshEngine()
        engine.setProfile(.slow3g)
        #expect(engine.config.latencyMs == 400)
        engine.setProfile(.fast3g)
        #expect(engine.config.latencyMs == 150)
        #expect(engine.config.downloadKbps == 1500)
    }

    @Test func switchingToNoneAfterOfflineClearsFlags() {
        let engine = freshEngine()
        engine.setProfile(.offline)
        #expect(engine.isOffline == true)
        engine.setProfile(.none)
        #expect(engine.isOffline == false)
        #expect(engine.isActive == false)
    }

    // MARK: - delayForBytesMs math

    // Formula: bytesPerMs = (kbps × 1024) / 8 / 1000
    //          delayMs    = byteCount / bytesPerMs
    //
    // fast-3g: 1500 kbps → bytesPerMs = (1500 × 1024) / 8 / 1000 = 192
    //          1024 bytes → delayMs = 1024 / 192 ≈ 5.333 ms
    //
    // slow-3g: 400 kbps → bytesPerMs = (400 × 1024) / 8 / 1000 = 51.2
    //          1024 bytes → delayMs = 1024 / 51.2 = 20 ms
    //
    // edge:    240 kbps → bytesPerMs = (240 × 1024) / 8 / 1000 = 30.72
    //          1024 bytes → delayMs = 1024 / 30.72 ≈ 33.33 ms

    @Test func delayForBytesIsZeroWhenNone() {
        let engine = freshEngine()
        // profile is none → downloadKbps == 0 → no delay
        #expect(engine.delayForBytesMs(1024) == 0)
    }

    @Test func delayForBytesIsZeroWhenOffline() {
        let engine = freshEngine()
        engine.setProfile(.offline)
        // downloadKbps == 0 for offline
        #expect(engine.delayForBytesMs(1024) == 0)
    }

    @Test func delayForZeroBytesIsZero() {
        let engine = freshEngine()
        engine.setProfile(.fast3g)
        #expect(engine.delayForBytesMs(0) == 0)
    }

    @Test func delayMathFast3g1KBChunk() {
        let engine = freshEngine()
        engine.setProfile(.fast3g)
        // bytesPerMs = (1500 × 1024) / 8 / 1000 = 192.0
        // 1024 bytes → 1024 / 192 = 5.333… ms
        let delayMs = engine.delayForBytesMs(1024)
        let expected = 1024.0 / ((1500.0 * 1024.0) / 8.0 / 1000.0)
        #expect(abs(delayMs - expected) < 0.001)
    }

    @Test func delayMathSlow3g1KBChunk() {
        let engine = freshEngine()
        engine.setProfile(.slow3g)
        // bytesPerMs = (400 × 1024) / 8 / 1000 = 51.2
        // 1024 bytes → 20.0 ms exactly
        let delayMs = engine.delayForBytesMs(1024)
        #expect(abs(delayMs - 20.0) < 0.001)
    }

    @Test func delayMathEdge1KBChunk() {
        let engine = freshEngine()
        engine.setProfile(.edge)
        // bytesPerMs = (240 × 1024) / 8 / 1000 = 30.72
        // 1024 bytes → 1024 / 30.72 ≈ 33.333 ms
        let delayMs = engine.delayForBytesMs(1024)
        let expected = 1024.0 / ((240.0 * 1024.0) / 8.0 / 1000.0)
        #expect(abs(delayMs - expected) < 0.001)
    }

    @Test func delayScalesLinearly() {
        let engine = freshEngine()
        engine.setProfile(.slow3g)
        let delay1 = engine.delayForBytesMs(1024)
        let delay2 = engine.delayForBytesMs(2048)
        #expect(abs(delay2 - delay1 * 2) < 0.001)
    }

    @Test func delayForLargeBody() {
        let engine = freshEngine()
        engine.setProfile(.slow3g)
        // 100 KB → 100 × 20 ms = 2000 ms
        let delayMs = engine.delayForBytesMs(100 * 1024)
        #expect(abs(delayMs - 2000.0) < 0.01)
    }

    // MARK: - delayForBytes (seconds) consistency

    @Test func delayForBytesSecondsMatchesMs() {
        let engine = freshEngine()
        engine.setProfile(.fast3g)
        let ms = engine.delayForBytesMs(1024)
        let seconds = engine.delayForBytes(1024)
        // delayForBytes returns seconds; should equal ms / 1000
        #expect(abs(seconds - ms / 1000.0) < 0.000_001)
    }

    // MARK: - Observation

    @Test func subscriberReceivesChangeOnSetProfile() async {
        let engine = freshEngine()
        var receivedCount = 0
        let unsub = engine.subscribe { receivedCount += 1 }
        engine.setProfile(.slow3g)

        // Notification is posted to main queue; yield briefly.
        try? await Task.sleep(for: .milliseconds(20))

        #expect(receivedCount == 1)
        unsub()
    }

    @Test func unsubscribePreventsNotification() async {
        let engine = freshEngine()
        var receivedCount = 0
        let unsub = engine.subscribe { receivedCount += 1 }
        unsub()
        engine.setProfile(.slow3g)

        try? await Task.sleep(for: .milliseconds(20))

        #expect(receivedCount == 0)
    }

    // MARK: - ThrottleConfig equality

    @Test func configEqualityWhenSameValues() {
        let a = ThrottleConfig(profile: .fast3g, latencyMs: 150, downloadKbps: 1500)
        let b = ThrottleConfig(profile: .fast3g, latencyMs: 150, downloadKbps: 1500)
        #expect(a == b)
    }

    @Test func configInequalityOnDifferentProfile() {
        let a = ThrottleConfig(profile: .fast3g, latencyMs: 150, downloadKbps: 1500)
        let b = ThrottleConfig(profile: .slow3g, latencyMs: 400, downloadKbps: 400)
        #expect(a != b)
    }

    // MARK: - ThrottleProfile CaseIterable

    @Test func allCasesContainsExpectedProfiles() {
        let all = ThrottleProfile.allCases
        #expect(all.contains(.none))
        #expect(all.contains(.fast3g))
        #expect(all.contains(.slow3g))
        #expect(all.contains(.edge))
        #expect(all.contains(.offline))
        #expect(all.contains(.custom))
        #expect(all.count == 6)
    }

    @Test func profileRawValues() {
        #expect(ThrottleProfile.none.rawValue    == "none")
        #expect(ThrottleProfile.fast3g.rawValue  == "fast-3g")
        #expect(ThrottleProfile.slow3g.rawValue  == "slow-3g")
        #expect(ThrottleProfile.edge.rawValue    == "edge")
        #expect(ThrottleProfile.offline.rawValue == "offline")
        #expect(ThrottleProfile.custom.rawValue  == "custom")
    }

    // MARK: - Custom profile

    @Test func setCustomAppliesExplicitValues() {
        let engine = freshEngine()
        engine.setCustom(latencyMs: 77, downloadKbps: 999)
        #expect(engine.config.profile == .custom)
        #expect(engine.config.latencyMs == 77)
        #expect(engine.config.downloadKbps == 999)
        #expect(engine.isActive == true)
    }

    @Test func setCustomDefaultsDownloadKbpsToZero() {
        let engine = freshEngine()
        engine.setCustom(latencyMs: 50)
        #expect(engine.config.downloadKbps == 0)
    }

    @Test func setCustomClampsNegativeValuesToZero() {
        let engine = freshEngine()
        engine.setCustom(latencyMs: -10, downloadKbps: -5)
        #expect(engine.config.latencyMs == 0)
        #expect(engine.config.downloadKbps == 0)
    }

    @Test func setProfileCustomWithoutSetCustomPreservesExistingValues() {
        let engine = freshEngine()
        engine.setCustom(latencyMs: 42, downloadKbps: 100)
        engine.setProfile(.custom)
        #expect(engine.config.profile == .custom)
        #expect(engine.config.latencyMs == 42)
        #expect(engine.config.downloadKbps == 100)
    }
}
