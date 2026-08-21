import HakkaCommon
import HakkaCore
import Testing

@Suite("RuleEntryDisplay")
struct RuleEntryDisplayTests {
    @Test func mockShowsWhatItServes()
    async throws {
        let entry = RuleEntry(
            id: "mck-1",
            payload: .mock(MockRuleInput(
                pattern: "https://api.example.com/v1/users",
                method: "GET",
                response: MockResponse(status: 418, headers: [:], body: "teapot", delay: 0)
            ))
        )
        let display = RuleEntryDisplay(entry)
        #expect(display.kind == .mock)
        #expect(display.title == "GET https://api.example.com/v1/users")
        #expect(display.subtitle == "Serves 418")
    }

    @Test func mockWithoutMethodOmitsItFromTitle()
    async throws {
        let entry = RuleEntry(
            id: "mck-2",
            payload: .mock(MockRuleInput(
                pattern: "https://api.example.com/anything",
                response: MockResponse(status: 200, headers: [:], body: "", delay: 0)
            ))
        )
        #expect(RuleEntryDisplay(entry).title == "https://api.example.com/anything")
        #expect(RuleEntryDisplay(entry).subtitle == "Serves 200")
    }

    @Test func blockAndRedirectSaySo()
    async throws {
        let blocked = RuleEntry(
            id: "mck-3",
            payload: .mock(MockRuleInput(
                pattern: "https://ads.example.com/",
                response: MockResponse(status: 403, headers: [:], body: "", delay: 0),
                block: true
            ))
        )
        let redirected = RuleEntry(
            id: "mck-4",
            payload: .mock(MockRuleInput(
                pattern: "https://prod.example.com/",
                response: MockResponse(status: 200, headers: [:], body: "", delay: 0),
                redirectTo: "https://staging.example.com/"
            ))
        )
        #expect(RuleEntryDisplay(blocked).subtitle == "Blocked")
        #expect(RuleEntryDisplay(redirected).subtitle == "Redirected")
    }

    @Test func breakpointPhrasesByPhase()
    async throws {
        func breakpoint(_ phase: BreakpointPhase) -> RuleEntry {
            RuleEntry(
                id: "brk-\(phase.rawValue)",
                payload: .breakpoint(BreakpointInput(pattern: "https://api.example.com/pay", method: "POST", on: phase))
            )
        }
        #expect(RuleEntryDisplay(breakpoint(.request)).subtitle == "Pauses request")
        #expect(RuleEntryDisplay(breakpoint(.response)).subtitle == "Pauses response")
        #expect(RuleEntryDisplay(breakpoint(.both)).subtitle == "Pauses request + response")
        #expect(RuleEntryDisplay(breakpoint(.both)).title == "POST https://api.example.com/pay")
    }
}
