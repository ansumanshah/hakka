import HakkaCommon
import HakkaCore
import Testing

@Suite("RuleMatcher")
struct RuleMatcherTests {
    private func mockEntry(
        pattern: String,
        isRegex: Bool = false,
        regexFlags: String? = nil,
        method: String? = nil,
        enabled: Bool = true,
        block: Bool = false
    ) -> RuleEntry {
        RuleEntry(
            id: "r-1",
            payload: .mock(MockRuleInput(
                pattern: pattern,
                isRegex: isRegex,
                regexFlags: regexFlags,
                method: method,
                response: MockResponse(status: 200),
                block: block
            )),
            isEnabled: enabled
        )
    }

    @Test func plainPatternMatchesBySubstring()
    async throws {
        let entry = mockEntry(pattern: "api.example.com/v1/users")
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/v1/users?page=2", method: "GET"))
        #expect(!RuleMatcher.matches(entry, url: "https://api.example.com/v2/users", method: "GET"))
    }

    @Test func patternWithoutQueryStillMatchesUrlWithQuery()
    async throws {
        // The capture→mock promotion targets endpoints, not query strings —
        // observed hits must agree.
        let entry = mockEntry(pattern: "https://api.example.com/v1/users")
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/v1/users?token=abc&x=1", method: "GET"))
    }

    @Test func methodNarrowsCaseInsensitively()
    async throws {
        let entry = mockEntry(pattern: "api.example.com", method: "post")
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/x", method: "POST"))
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/x", method: "post"))
        #expect(!RuleMatcher.matches(entry, url: "https://api.example.com/x", method: "GET"))
    }

    @Test func nilMethodMatchesEverything()
    async throws {
        let entry = mockEntry(pattern: "api.example.com")
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/x", method: "DELETE"))
    }

    @Test func disabledRulesNeverMatch()
    async throws {
        let entry = mockEntry(pattern: "api.example.com", enabled: false)
        #expect(!RuleMatcher.matches(entry, url: "https://api.example.com/x", method: "GET"))
    }

    @Test func regexPatternsSearchTheFullUrl()
    async throws {
        let entry = mockEntry(pattern: "/v\\d+/users/\\d+$", isRegex: true)
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/v1/users/42", method: "GET"))
        #expect(!RuleMatcher.matches(entry, url: "https://api.example.com/v1/users/42/friends", method: "GET"))
    }

    @Test func regexFlagsMapLikeTheEngines()
    async throws {
        let entry = mockEntry(pattern: "USERS", isRegex: true, regexFlags: "i")
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/users", method: "GET"))
        let anchored = mockEntry(pattern: "^users", isRegex: true)
        #expect(!RuleMatcher.matches(anchored, url: "https://api.example.com/users", method: "GET"))
    }

    @Test func invalidRegexNeverMatches()
    async throws {
        let entry = mockEntry(pattern: "([", isRegex: true)
        #expect(!RuleMatcher.matches(entry, url: "https://api.example.com/x", method: "GET"))
    }

    @Test func breakpointsMatchBySubstringAnyPhase()
    async throws {
        let entry = RuleEntry(
            id: "b-1",
            payload: .breakpoint(BreakpointInput(pattern: "api.example.com/pay", method: "POST", on: .response))
        )
        #expect(RuleMatcher.matches(entry, url: "https://api.example.com/pay?x=1", method: "POST"))
        #expect(!RuleMatcher.matches(entry, url: "https://api.example.com/pay", method: "GET"))
        let disabled = RuleEntry(
            id: "b-2",
            payload: .breakpoint(BreakpointInput(pattern: "api.example.com", on: .both)),
            isEnabled: false
        )
        #expect(!RuleMatcher.matches(disabled, url: "https://api.example.com/x", method: "GET"))
    }
}
