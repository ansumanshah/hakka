import Testing
@testable import HakkaApp

@Suite("Proxy bandwidth profiles")
struct ProxyBandwidthProfileTests {
    @Test func presetUsesSeparateBytePerSecondDirections() {
        let profile = ProxyBandwidthConfiguration(profile: .fast3G)
        #expect(profile.effectiveLatencyMs == 150)
        #expect(profile.effectiveUploadBytesPerSecond == 96_000)
        #expect(profile.effectiveDownloadBytesPerSecond == 204_800)
        #expect(profile.validationMessage == nil)
    }

    @Test func customProfileRequiresAndBoundsACondition() {
        #expect(ProxyBandwidthConfiguration(profile: .custom).validationMessage == "Enter latency, upload bandwidth, or download bandwidth.")
        #expect(ProxyBandwidthConfiguration(profile: .custom, downloadBytesPerSecond: 0).validationMessage == "Download bandwidth must be between 1 and 1073741824 B/s.")
        #expect(ProxyBandwidthConfiguration(profile: .custom, latencyMs: 25).validationMessage == nil)
    }

    @Test func offlineNeverStartsARelayLimit() {
        let profile = ProxyBandwidthConfiguration(profile: .offline)
        #expect(profile.isOffline)
        #expect(profile.effectiveUploadBytesPerSecond == nil)
        #expect(profile.effectiveDownloadBytesPerSecond == nil)
    }
}
