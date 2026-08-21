import HakkaCommon
import HakkaCore
import Testing

/// Status-based and body/header-disagreement rules of `RequestDiagnoser`
/// (401/304/413/429, Content-Type mismatch). Transport-failure and
/// redirect-chain rules live in `RequestDiagnosisTransportTests`.
@Suite("RequestDiagnosis.Status")
struct RequestDiagnosisStatusTests {
    private func record(
        status: Int? = nil,
        requestHeaders: [String: [String]] = [:],
        responseHeaders: [String: [String]] = [:],
        requestBodySize: Int64 = 0,
        responseBody: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            url: "https://api.example.com/v1/thing",
            method: .get,
            status: status,
            startTime: 1_000,
            requestHeaders: requestHeaders,
            responseHeaders: responseHeaders,
            requestBodySize: requestBodySize,
            responseBody: responseBody
        )
    }

    // MARK: 401 — missing vs rejected credential

    @Test func unauthorizedWithNoAuthHeaderNamesTheAbsence()
    async throws {
        let d = RequestDiagnoser.diagnose(record(status: 401))
        #expect(d?.text == "401 with no Authorization header on the request: the credential was never sent.")
        #expect(d?.severity == .error)
    }

    @Test func unauthorizedWithAuthHeaderNamesRejection()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 401,
            requestHeaders: ["Authorization": ["Bearer abc"]]
        ))
        #expect(d?.text == "401 with an Authorization header present: the credential was sent and rejected.")
    }

    @Test func nonUnauthorizedStatusProducesNoAuthDiagnosis()
    async throws {
        let d = RequestDiagnoser.diagnose(record(status: 403))
        #expect(d == nil)
    }

    // MARK: 304 — cache validator

    @Test func notModifiedWithIfNoneMatchNamesTheValidator()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 304,
            requestHeaders: ["If-None-Match": ["\"abc123\""]]
        ))
        #expect(d?.text == "304 Not Modified: served from cache, matched by If-None-Match.")
        #expect(d?.severity == .info)
    }

    @Test func notModifiedWithIfModifiedSinceNamesThatValidator()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 304,
            requestHeaders: ["If-Modified-Since": ["Wed, 21 Oct 2026 07:28:00 GMT"]]
        ))
        #expect(d?.text.contains("If-Modified-Since") == true)
    }

    @Test func notModifiedWithNoConditionalHeaderProducesNothing()
    async throws {
        let d = RequestDiagnoser.diagnose(record(status: 304))
        #expect(d == nil)
    }

    // MARK: 413 — request body size

    @Test func payloadTooLargeNamesTheSize()
    async throws {
        let d = RequestDiagnoser.diagnose(record(status: 413, requestBodySize: 20_000_000))
        #expect(d?.text.hasPrefix("413 Payload Too Large: the request body was") == true)
        #expect(d?.severity == .error)
    }

    @Test func payloadTooLargeWithUnknownSizeProducesNothing()
    async throws {
        let d = RequestDiagnoser.diagnose(record(status: 413, requestBodySize: 0))
        #expect(d == nil)
    }

    // MARK: 429 — Retry-After

    @Test func rateLimitedSurfacesRetryAfter()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 429,
            responseHeaders: ["Retry-After": ["30"]]
        ))
        #expect(d?.text == "429 Too Many Requests: server asked to retry after 30.")
        #expect(d?.severity == .warning)
    }

    @Test func rateLimitedWithoutRetryAfterProducesNothing()
    async throws {
        let d = RequestDiagnoser.diagnose(record(status: 429))
        #expect(d == nil)
    }

    // MARK: Content-Type / body disagreement

    @Test func jsonContentTypeWithNonJsonBodyIsFlagged()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 200,
            responseHeaders: ["Content-Type": ["application/json"]],
            responseBody: "<html>not json</html>"
        ))
        #expect(d?.text == "Content-Type declared JSON, but the response body did not parse as JSON.")
        #expect(d?.severity == .warning)
    }

    @Test func jsonContentTypeWithValidJsonBodyProducesNothing()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 200,
            responseHeaders: ["Content-Type": ["application/json"]],
            responseBody: #"{"ok":true}"#
        ))
        #expect(d == nil)
    }

    @Test func nonJsonContentTypeIsNeverFlaggedForShape()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 200,
            responseHeaders: ["Content-Type": ["text/html"]],
            responseBody: "<html>fine</html>"
        ))
        #expect(d == nil)
    }

    // MARK: Healthy baseline

    @Test func plainSuccessfulRequestGetsNoDiagnosis()
    async throws {
        let d = RequestDiagnoser.diagnose(record(
            status: 200,
            responseHeaders: ["Content-Type": ["text/plain"]],
            responseBody: "ok"
        ))
        #expect(d == nil)
    }
}
