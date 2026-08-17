import Testing
@testable import HakkaNetwork
import HakkaCommon
import Foundation

// MARK: - MockRuleBuilder Tests
//
// "Mock this" (detail header QA action): freezes a captured `NetworkRequest`
// into a `MockRuleInput`. Mirrors `generateMockRules` in
// `packages/hakka-core/src/engine/mockFromTraffic.ts` — see that file's test suite
// (`mockFromTraffic.test.ts`) for the batch/dedup behavior this single-request
// builder is the building block of.

@Suite("MockRuleBuilder")
struct MockRuleBuilderTests {

    private func makeRequest(
        url: String = "https://api.example.com/users/1",
        method: HttpMethod = .get,
        status: Int? = 200,
        responseHeaders: [String: [String]] = [:],
        responseBody: String? = "{\"ok\":true}",
        error: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            url: url,
            method: method,
            status: status,
            startTime: 1,
            responseHeaders: responseHeaders,
            responseBody: responseBody,
            error: error
        )
    }

    // MARK: - Skip-pending

    @Test func skipsRequestWithNoStatusAndNoBody() {
        let pending = makeRequest(status: nil, responseBody: nil)
        #expect(MockRuleBuilder.isUnusable(pending))
        #expect(MockRuleBuilder.build(from: pending) == nil)
    }

    @Test func skipsErroredRequestWithNoStatus() {
        let errored = makeRequest(status: nil, responseBody: nil, error: "Network request failed")
        #expect(MockRuleBuilder.build(from: errored) == nil)
    }

    @Test func keepsRequestWithStatusButEmptyBody() {
        let noContent = makeRequest(status: 204, responseBody: nil)
        let rule = MockRuleBuilder.build(from: noContent)
        #expect(rule != nil)
        #expect(rule?.response.status == 204)
        #expect(rule?.response.body == "")
    }

    @Test func keepsRequestWithNoStatusButCapturedBody() {
        let req = makeRequest(status: nil, responseBody: "{\"partial\":true}")
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule != nil)
        #expect(rule?.response.status == 200) // falls back to 200 default
        #expect(rule?.response.body == "{\"partial\":true}")
    }

    // MARK: - Pattern derivation (path+query, origin stripped)

    @Test func stripsSchemeAndHostKeepsPath() {
        let req = makeRequest(url: "https://api.example.com/v1/orders/42")
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.pattern == "/v1/orders/42")
    }

    @Test func keepsQueryString() {
        let req = makeRequest(url: "https://api.example.com/search?q=shoes&page=2")
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.pattern == "/search?q=shoes&page=2")
    }

    @Test func patternDoesNotContainHost() {
        let req = makeRequest(url: "https://prod.example.com/v1/orders/42")
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.pattern.contains("prod.example.com") == false)
        #expect(rule?.pattern == "/v1/orders/42")
    }

    @Test func emptyPathFallsBackToSlash() {
        let req = makeRequest(url: "https://api.example.com")
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.pattern == "/")
    }

    // MARK: - Carried-over fields

    @Test func carriesStatusMethodBodyAndEnabled() {
        let req = makeRequest(
            url: "https://api.example.com/users/1",
            method: .post,
            status: 201,
            responseHeaders: ["Content-Type": ["application/json"], "X-Request-Id": ["abc"]],
            responseBody: "{\"id\":1}"
        )
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule != nil)
        #expect(rule?.method == "POST")
        #expect(rule?.isRegex == false)
        #expect(rule?.enabled == true)
        #expect(rule?.response.status == 201)
        #expect(rule?.response.body == "{\"id\":1}")
        #expect(rule?.response.headers == ["content-type": "application/json"])
    }

    @Test func omitsHeadersWhenNoContentTypeWasCaptured() {
        let req = makeRequest(responseHeaders: ["X-Request-Id": ["abc"]])
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.response.headers.isEmpty == true)
    }

    @Test func omitsHeadersWhenNoResponseHeadersWereCaptured() {
        let req = makeRequest(responseHeaders: [:])
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.response.headers.isEmpty == true)
    }

    @Test func contentTypeLookupIsCaseInsensitive() {
        let req = makeRequest(responseHeaders: ["content-type": ["text/plain"]])
        let rule = MockRuleBuilder.build(from: req)
        #expect(rule?.response.headers["content-type"] == "text/plain")
    }

    // MARK: - End-to-end: builds a rule that actually matches via MockEngine

    @Test func builtRuleMatchesTheOriginatingRequestShape() {
        let req = makeRequest(
            url: "https://api.example.com/users/1?expand=profile",
            method: .get,
            status: 200,
            responseBody: "{\"name\":\"Alice\"}"
        )
        guard let input = MockRuleBuilder.build(from: req) else {
            Issue.record("expected a rule to be built")
            return
        }
        let engine = MockEngine()
        engine.addRule(input)

        let result = engine.match(url: "https://staging.example.com/users/1?expand=profile", method: "GET")
        #expect(result != nil)
        #expect(result?.response.status == 200)
        #expect(result?.response.body == "{\"name\":\"Alice\"}")
    }

    @Test func builtRuleIsMethodScoped() {
        let req = makeRequest(url: "https://api.example.com/users/1", method: .delete, status: 204, responseBody: nil)
        guard let input = MockRuleBuilder.build(from: req) else {
            Issue.record("expected a rule to be built")
            return
        }
        let engine = MockEngine()
        engine.addRule(input)

        #expect(engine.match(url: "https://api.example.com/users/1", method: "GET") == nil)
        #expect(engine.match(url: "https://api.example.com/users/1", method: "DELETE") != nil)
    }
}
