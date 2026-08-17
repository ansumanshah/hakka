import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - MockEngine Tests

@Suite("MockEngine", .serialized)
struct MockEngineTests {

    private func freshEngine() -> MockEngine {
        MockEngine()
    }

    // MARK: - Rule management

    @Test func addRuleReturnsUniqueId() {
        let engine = freshEngine()
        let id1 = engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse(body: "[]")
        ))
        let id2 = engine.addRule(MockRuleInput(
            pattern: "/api/posts",
            response: MockResponse(body: "[]")
        ))
        #expect(id1 != id2)
        #expect(id1.hasPrefix("mock_"))
        #expect(id2.hasPrefix("mock_"))
    }

    @Test func getRulesReturnsAllRules() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/a", response: MockResponse()))
        engine.addRule(MockRuleInput(pattern: "/b", response: MockResponse()))
        #expect(engine.getRules().count == 2)
    }

    @Test func removeRuleDeletesById() {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse()
        ))
        #expect(engine.getRules().count == 1)
        engine.removeRule(id: id)
        #expect(engine.getRules().isEmpty)
    }

    @Test func removeNonexistentRuleIsNoOp() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/a", response: MockResponse()))
        engine.removeRule(id: "nonexistent")
        #expect(engine.getRules().count == 1)
    }

    @Test func clearRulesRemovesAll() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/a", response: MockResponse()))
        engine.addRule(MockRuleInput(pattern: "/b", response: MockResponse()))
        engine.clearRules()
        #expect(engine.getRules().isEmpty)
    }

    // MARK: - Global delay

    @Test func globalDelayDefaultsToZero() {
        #expect(freshEngine().getGlobalDelay() == 0)
    }

    @Test func setGlobalDelayRoundTripsAndClampsNegatives() {
        let engine = freshEngine()
        engine.setGlobalDelay(0.25)
        #expect(engine.getGlobalDelay() == 0.25)
        engine.setGlobalDelay(-1)
        #expect(engine.getGlobalDelay() == 0)
    }

    @Test func clearRulesResetsGlobalDelay() {
        let engine = freshEngine()
        engine.setGlobalDelay(0.5)
        engine.clearRules()
        #expect(engine.getGlobalDelay() == 0)
    }

    // MARK: - Enable / Disable

    @Test func disableRulePreventsMatching() {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse(status: 200)
        ))
        engine.disableRule(id: id)

        let result = engine.match(url: "https://example.com/api/users", method: "GET")
        #expect(result == nil)

        let rules = engine.getRules()
        #expect(rules.first?.enabled == false)
    }

    @Test func enableRuleRestoresMatching() {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse(status: 200),
            enabled: false
        ))
        #expect(engine.match(url: "https://example.com/api/users", method: "GET") == nil)

        engine.enableRule(id: id)
        let result = engine.match(url: "https://example.com/api/users", method: "GET")
        #expect(result != nil)
    }

    @Test func enableDisableNonexistentIdIsNoOp() {
        let engine = freshEngine()
        engine.enableRule(id: "nope")
        engine.disableRule(id: "nope")
        // No crash = pass
    }

    // MARK: - Substring matching

    @Test func matchesSubstringPattern() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse(status: 200, body: "{\"users\":[]}")
        ))

        let result = engine.match(url: "https://example.com/api/users?page=1", method: "GET")
        #expect(result != nil)
        #expect(result?.response.status == 200)
        #expect(result?.response.body == "{\"users\":[]}")
    }

    @Test func noMatchReturnsNil() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse()
        ))

        let result = engine.match(url: "https://example.com/api/posts", method: "GET")
        #expect(result == nil)
    }

    // MARK: - Regex matching

    @Test func matchesRegexPattern() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: #"/api/users/\d+"#,
            isRegex: true,
            response: MockResponse(status: 200, body: "{\"id\":1}")
        ))

        let result = engine.match(url: "https://example.com/api/users/42", method: "GET")
        #expect(result != nil)
        #expect(result?.response.body == "{\"id\":1}")
    }

    @Test func regexNoMatchReturnsNil() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: #"/api/users/\d+"#,
            isRegex: true,
            response: MockResponse()
        ))

        let result = engine.match(url: "https://example.com/api/users/abc", method: "GET")
        #expect(result == nil)
    }

    @Test func invalidRegexNeverMatches() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "[invalid",
            isRegex: true,
            response: MockResponse()
        ))

        let result = engine.match(url: "https://example.com/anything", method: "GET")
        #expect(result == nil)
    }

    // MARK: - Method filtering

    @Test func methodMatchIsCaseInsensitive() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            method: "post",
            response: MockResponse(status: 201)
        ))

        let result = engine.match(url: "https://example.com/api", method: "POST")
        #expect(result != nil)
    }

    @Test func nilMethodMatchesAllMethods() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(status: 200)
        ))

        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil)
        #expect(engine.match(url: "https://example.com/api", method: "POST") != nil)
        #expect(engine.match(url: "https://example.com/api", method: "DELETE") != nil)
    }

    // MARK: - Hit count

    @Test func hitCountIncrementsOnMatch() {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse()
        ))

        _ = engine.match(url: "https://example.com/api", method: "GET")
        _ = engine.match(url: "https://example.com/api", method: "POST")
        _ = engine.match(url: "https://example.com/other", method: "GET") // no match

        let rules = engine.getRules()
        let rule = rules.first { $0.id == id }
        #expect(rule?.hitCount == 2)
    }

    // MARK: - Priority (first match wins)

    @Test func firstMatchingRuleWins() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(status: 200, body: "first")
        ))
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(status: 201, body: "second")
        ))

        let result = engine.match(url: "https://example.com/api", method: "GET")
        #expect(result?.response.body == "first")
        #expect(result?.response.status == 200)
    }

    // MARK: - Disabled rule added

    @Test func ruleAddedAsDisabledStaysDisabled() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(),
            enabled: false
        ))

        let result = engine.match(url: "https://example.com/api", method: "GET")
        #expect(result == nil)
        #expect(engine.getRules().first?.enabled == false)
    }

    // MARK: - MockRule Identifiable

    @Test func mockRuleConformsToIdentifiable() {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse()
        ))
        let rule = engine.getRules().first
        #expect(rule?.id == id)
    }

    // MARK: - Mock response with delay

    @Test func mockResponseWithPositiveDelay() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api/slow",
            response: MockResponse(status: 200, body: "delayed", delay: 1.5)
        ))
        let result = engine.match(url: "https://example.com/api/slow", method: "GET")
        #expect(result != nil)
        #expect(result?.response.delay == 1.5)
        #expect(result?.response.body == "delayed")
    }

    // MARK: - Mock with custom headers

    @Test func mockResponseWithCustomHeaders() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api/data",
            response: MockResponse(
                status: 200,
                headers: ["Content-Type": "application/json", "X-Custom": "value"],
                body: "{}"
            )
        ))
        let result = engine.match(url: "https://example.com/api/data", method: "GET")
        #expect(result?.response.headers["Content-Type"] == "application/json")
        #expect(result?.response.headers["X-Custom"] == "value")
        #expect(result?.response.headers.count == 2)
    }

    // MARK: - Method-specific mock (only POST, not GET)

    @Test func methodSpecificMockOnlyMatchesTargetMethod() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api/users",
            method: "POST",
            response: MockResponse(status: 201, body: "{\"created\":true}")
        ))

        #expect(engine.match(url: "https://example.com/api/users", method: "GET") == nil)
        #expect(engine.match(url: "https://example.com/api/users", method: "PUT") == nil)
        #expect(engine.match(url: "https://example.com/api/users", method: "DELETE") == nil)
        #expect(engine.match(url: "https://example.com/api/users", method: "PATCH") == nil)

        let postResult = engine.match(url: "https://example.com/api/users", method: "POST")
        #expect(postResult != nil)
        #expect(postResult?.response.status == 201)
    }

    // MARK: - Multiple rules matching same URL — first match wins

    @Test func multipleMatchingRulesFirstWins() {
        let engine = freshEngine()
        let id1 = engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse(status: 200, body: "first-rule")
        ))
        let id2 = engine.addRule(MockRuleInput(
            pattern: "/api/users",
            response: MockResponse(status: 201, body: "second-rule")
        ))

        let result = engine.match(url: "https://example.com/api/users", method: "GET")
        #expect(result?.response.body == "first-rule")

        // Verify only first rule's hit count incremented
        let rules = engine.getRules()
        #expect(rules.first { $0.id == id1 }?.hitCount == 1)
        #expect(rules.first { $0.id == id2 }?.hitCount == 0)
    }

    // MARK: - Mock response body encoding

    @Test func mockResponseBodyWithUnicode() {
        let engine = freshEngine()
        let body = "{\"name\":\"日本語テスト\"}"
        engine.addRule(MockRuleInput(
            pattern: "/api/unicode",
            response: MockResponse(body: body)
        ))
        let result = engine.match(url: "https://example.com/api/unicode", method: "GET")
        #expect(result?.response.body == body)
    }

    // MARK: - Disable first rule, second matches

    @Test func disableFirstRuleSecondMatches() {
        let engine = freshEngine()
        let id1 = engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(status: 200, body: "first")
        ))
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(status: 201, body: "second")
        ))

        engine.disableRule(id: id1)
        let result = engine.match(url: "https://example.com/api", method: "GET")
        #expect(result?.response.body == "second")
        #expect(result?.response.status == 201)
    }

    // MARK: - redirectTo / block / modify (parity with `MockEngine.ts`)

    @Test func defaultsHaveNoRedirectBlockOrModifyAndAreNotRewrite() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.redirectTo == nil)
        #expect(rule?.block == false)
        #expect(rule?.modify == nil)
        #expect(rule?.isRewrite == false)
    }

    @Test func redirectToIsCarriedThroughAndMarksRuleAsRewrite() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(),
            redirectTo: "https://other.example.com/api"
        ))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.redirectTo == "https://other.example.com/api")
        #expect(rule?.isRewrite == true)
    }

    @Test func blockIsCarriedThroughButDoesNotAloneMarkRewrite() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(),
            block: true
        ))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.block == true)
        // block is checked ahead of isRewrite by callers (HakkaURLProtocol) —
        // isRewrite itself only reflects redirectTo/modify, mirroring
        // MockEngine.ts's `isRewrite(rule)` exactly.
        #expect(rule?.isRewrite == false)
    }

    @Test func modifyIsCarriedThroughAndMarksRuleAsRewrite() {
        let engine = freshEngine()
        let modify = MockRuleModify(
            setRequestHeaders: ["X-A": "1"],
            removeRequestHeaders: ["X-B"],
            setQueryParams: ["q": "1"],
            removeQueryParams: ["r"],
            status: 201,
            setResponseHeaders: ["X-C": "2"],
            removeResponseHeaders: ["X-D"],
            replaceBody: [MockRuleModify.BodyReplacement(find: "a", replace: "b")]
        )
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), modify: modify))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.modify == modify)
        #expect(rule?.isRewrite == true)
    }

    // MARK: - Observation (subscribe) — same contract as BreakpointEngine/ThrottleEngine

    @Test func subscriberReceivesChangeOnAddRule() async {
        let engine = freshEngine()
        var receivedCount = 0
        let unsub = engine.subscribe { receivedCount += 1 }
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))

        try? await Task.sleep(for: .milliseconds(20))

        #expect(receivedCount == 1)
        unsub()
    }

    @Test func subscriberReceivesChangeOnRemoveEnableDisableClear() async {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))

        var receivedCount = 0
        let unsub = engine.subscribe { receivedCount += 1 }

        engine.disableRule(id: id)
        engine.enableRule(id: id)
        engine.removeRule(id: id)
        engine.addRule(MockRuleInput(pattern: "/other", response: MockResponse()))
        engine.clearRules()

        try? await Task.sleep(for: .milliseconds(20))

        #expect(receivedCount == 5)
        unsub()
    }

    @Test func unsubscribePreventsNotification() async {
        let engine = freshEngine()
        var receivedCount = 0
        let unsub = engine.subscribe { receivedCount += 1 }
        unsub()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))

        try? await Task.sleep(for: .milliseconds(20))

        #expect(receivedCount == 0)
    }
}
