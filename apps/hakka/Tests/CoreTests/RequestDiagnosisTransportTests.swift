import HakkaCommon
import HakkaCore
import Testing

/// Transport-failure and redirect-chain rules of `RequestDiagnoser`.
/// Status-based rules (401/304/413/429, content-type mismatch) live in
/// `RequestDiagnosisStatusTests`.
@Suite("RequestDiagnosis.Transport")
struct RequestDiagnosisTransportTests {
    private func record(
        status: Int? = nil,
        requestHeaders: [String: [String]] = [:],
        error: String? = nil,
        dnsMs: Int64? = nil,
        tlsMs: Int64? = nil,
        connectMs: Int64? = nil,
        ttfbMs: Int64? = nil,
        redirectCount: Int = 0,
        redirectUrls: [String] = []
    ) -> NetworkRequest {
        NetworkRequest(
            url: "https://api.example.com/v1/thing",
            method: .get,
            status: status,
            startTime: 1_000,
            requestHeaders: requestHeaders,
            error: error,
            dnsMs: dnsMs,
            tlsMs: tlsMs,
            connectMs: connectMs,
            ttfbMs: ttfbMs,
            redirectCount: redirectCount,
            redirectUrls: redirectUrls
        )
    }

    @Test func tlsPresentWithErrorBlamesTheHandshake()
    async throws {
        let d = RequestDiagnoser.diagnose(record(error: "connection reset", dnsMs: 5, tlsMs: 12))
        #expect(d?.text == "TLS handshake started and did not complete: the connection died during the handshake.")
        #expect(d?.severity == .error)
    }

    @Test func fullConnectionWithLaterErrorDoesNotBlameHandshake()
    async throws {
        // dns, connect and ttfb all completed (tls absent) before an error
        // hit later (e.g. mid-download) — no phase rule pins this failure
        // to a stage, so no diagnosis rather than blaming the handshake.
        let d = RequestDiagnoser.diagnose(record(error: "timed out", dnsMs: 5, connectMs: 10, ttfbMs: 20))
        #expect(d == nil)
    }

    @Test func connectedThenSilentIsDiagnosed()
    async throws {
        let d = RequestDiagnoser.diagnose(record(error: "timed out", connectMs: 10))
        #expect(d?.text == "Connected to the server, then received no response before it failed.")
    }

    @Test func connectedAndAnsweredIsNotDiagnosedAsSilent()
    async throws {
        // No error at all — a successful request with no ttfb captured must
        // not be read as "never answered".
        let d = RequestDiagnoser.diagnose(record(status: 200, connectMs: 10))
        #expect(d == nil)
    }

    @Test func resolvedButCouldNotConnectIsDiagnosed()
    async throws {
        let d = RequestDiagnoser.diagnose(record(error: "connection refused", dnsMs: 8))
        #expect(d?.text == "DNS resolved the host, then the connection itself could not be established.")
    }

    @Test func resolvedAndConnectedIsNotDiagnosedAsConnectFailure()
    async throws {
        // dns and connect both completed, so "could not be established"
        // would be false — no rule should claim it.
        let d = RequestDiagnoser.diagnose(record(error: "some other failure", dnsMs: 8, connectMs: 10, ttfbMs: 5))
        #expect(d == nil)
    }

    @Test func errorWithNoTimingPhasesProducesNothing()
    async throws {
        // No dns/connect/tls/ttfb evidence and no redirects — nothing to
        // pin the failure to, so no diagnosis rather than a guess.
        let d = RequestDiagnoser.diagnose(record(error: "unknown error"))
        #expect(d == nil)
    }

    @Test func tlsFailureOnFinalRedirectHopKeepsBothFacts()
    async throws {
        // A request that redirected and then died mid-handshake on the
        // final hop must not lose the redirect context just because a
        // phase-specific reason also matched.
        let d = RequestDiagnoser.diagnose(record(
            error: "connection reset",
            tlsMs: 12,
            redirectCount: 2,
            redirectUrls: ["https://a.example.com/x", "https://b.example.com/y"]
        ))
        #expect(d?.text.contains("TLS handshake") == true)
        #expect(d?.text.contains("2 redirects") == true)
        #expect(d?.text.contains("https://b.example.com/y") == true)
    }

    @Test func redirectChainEndingInErrorNamesHopsAndFinalUrl()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            error: "connection reset",
            redirectCount: 2,
            redirectUrls: ["https://a.example.com/x", "https://b.example.com/y"]
        ))
        #expect(d?.text == "Failed after 2 redirects, ending at https://b.example.com/y.")
        #expect(d?.severity == .error)
    }

    @Test func successfulRedirectChainProducesNoErrorDiagnosis()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 200,
            redirectCount: 2,
            redirectUrls: ["https://a.example.com/x", "https://b.example.com/y"]
        ))
        #expect(d == nil)
    }
}
