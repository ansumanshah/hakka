import Testing
import Foundation
@testable import HakkaNetwork
import HakkaCommon

@Suite struct HakkaConfigTests {
    @Test func defaults() {
        let config = HakkaConfig.default
        #expect(config.maxRequests == 500)
        #expect(config.maxBodySize == 262_144)
        #expect(config.redactHeaders.contains("authorization"))
        #expect(config.redactHeaders.contains("proxy-authorization"))
        #expect(config.redactHeaders.contains("cookie"))
        #expect(config.redactHeaders.contains("set-cookie"))
        #expect(config.ignoreHosts.isEmpty)
        #expect(config.ignorePatterns.isEmpty)
        #expect(config.maxAge == nil)
    }

    @Test func customConfig() {
        let config = HakkaConfig(maxRequests: 100, maxBodySize: 1024, redactHeaders: ["X-Api-Key"], ignoreHosts: ["analytics.com"])
        #expect(config.maxRequests == 100)
        #expect(config.maxBodySize == 1024)
        #expect(config.redactHeaders.contains("x-api-key")) // lowercased
        #expect(config.ignoreHosts.contains("analytics.com"))
    }

    @Test func ignoredHostSuffixRequiresDnsLabelBoundary() throws {
        let interceptor = HakkaInterceptor(config: HakkaConfig(ignoreHosts: ["example.com"]))

        #expect(interceptor.shouldIgnore(url: try #require(URL(string: "https://example.com/v1"))))
        #expect(interceptor.shouldIgnore(url: try #require(URL(string: "https://api.example.com/v1"))))
        #expect(!interceptor.shouldIgnore(url: try #require(URL(string: "https://badexample.com/v1"))))
    }

    @Test func hostFilteringSupportsExactSuffixWildcardAndRegex() throws {
        let config = HakkaConfig(ignoreHosts: [
            "api.example.com",
            ".internal.example.com",
            "*.ads.example.com",
            #"/^telemetry\d+\.example\.com$/"#,
        ])

        #expect(config.shouldIgnoreHost("api.example.com"))
        #expect(config.shouldIgnoreHost("service.internal.example.com"))
        #expect(config.shouldIgnoreHost("pixel.ads.example.com"))
        #expect(config.shouldIgnoreHost("telemetry12.example.com"))
        #expect(!config.shouldIgnoreHost("badexample.com"))
        #expect(!config.shouldIgnoreHost("telemetry.example.com"))
    }

    @Test func urlFilteringSupportsExactWildcardRegexAndSubstring() {
        let config = HakkaConfig(ignorePatterns: [
            "https://api.example.com/health",
            "https://*.example.com/debug/*",
            #"/\/private\/\d+/"#,
            "analytics",
        ])

        #expect(config.shouldIgnoreURL("https://api.example.com/health"))
        #expect(config.shouldIgnoreURL("https://cdn.example.com/debug/logs"))
        #expect(config.shouldIgnoreURL("https://api.example.com/private/42"))
        #expect(config.shouldIgnoreURL("https://example.com/analytics/track"))
        #expect(!config.shouldIgnoreURL("https://api.example.com/users"))
    }

    @Test func headerRedactionSupportsWildcardAndRegex() {
        let config = HakkaConfig(redactHeaders: [
            "authorization",
            "x-*-token",
            #"/^x-secret-\d+$/"#,
        ])

        #expect(config.shouldRedactHeader("Authorization"))
        #expect(config.shouldRedactHeader("X-Access-Token"))
        #expect(config.shouldRedactHeader("x-secret-42"))
        #expect(!config.shouldRedactHeader("Content-Type"))
    }

    // MARK: - Trace config

    @Test func traceDisabledByDefault() {
        let config = HakkaConfig.default
        #expect(!config.traceEnabled)
        #expect(config.tracePropagateOrigins.isEmpty)
        #expect(!config.shouldInjectTrace(for: "api.example.com"))
    }

    @Test func traceEnabledInjectsForAllHostsWhenNoAllowlist() {
        let config = HakkaConfig(traceEnabled: true)
        #expect(config.shouldInjectTrace(for: "api.example.com"))
        #expect(config.shouldInjectTrace(for: "other.com"))
    }

    @Test func traceEnabledWithAllowlistRestrictsToListedHosts() {
        let config = HakkaConfig(traceEnabled: true, tracePropagateOrigins: ["api.example.com"])
        #expect(config.shouldInjectTrace(for: "api.example.com"))
        #expect(!config.shouldInjectTrace(for: "other.com"))
    }

    @Test func tracePropagateOriginsStoredLowercased() {
        let config = HakkaConfig(traceEnabled: true, tracePropagateOrigins: ["API.Example.COM"])
        #expect(config.tracePropagateOrigins.contains("api.example.com"))
        #expect(config.shouldInjectTrace(for: "api.example.com"))
        #expect(config.shouldInjectTrace(for: "API.EXAMPLE.COM")) // case-insensitive lookup
    }

    @Test func traceConfigPreservedByReplacing() {
        let config = HakkaConfig(traceEnabled: true, tracePropagateOrigins: ["api.example.com"])
        let updated = config.replacing(maxBodySize: 1024)
        #expect(updated.traceEnabled)
        #expect(updated.tracePropagateOrigins.contains("api.example.com"))
    }

    @Test func runtimeConfigUpdateRefreshesRetentionPolicy() {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let interceptor = HakkaInterceptor(config: HakkaConfig(maxRequests: 10, maxAge: nil))

        interceptor.commitProcessedCapture(
            NetworkRequest(id: "old", url: "https://test.com/old", method: .get, startTime: nowMs - 120_000)
        )
        #expect(interceptor.store.request(byId: "old") != nil)

        interceptor.updateConfig { config in
            config.replacing(maxAge: 60)
        }
        interceptor.commitProcessedCapture(
            NetworkRequest(id: "recent", url: "https://test.com/recent", method: .get, startTime: nowMs - 10_000)
        )

        #expect(interceptor.config.maxAge == 60)
        #expect(interceptor.retentionPolicy.maxAge == 60)
        #expect(interceptor.store.request(byId: "old") == nil)
        #expect(interceptor.store.request(byId: "recent") != nil)
    }
}
