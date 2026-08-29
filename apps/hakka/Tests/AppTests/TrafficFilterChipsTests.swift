import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `TrafficFilterChips` is pure text transforms over `searchText` — no
/// `TrafficModel`, no view, needed to exercise it. The acceptance bar for
/// this whole affordance: a chip tap must be indistinguishable, at the
/// `TrafficQuery` level, from typing the DSL token it represents — chips are
/// a UI convenience over the existing grammar, not a second one.
@Suite("Traffic filter chips")
struct TrafficFilterChipsTests {
    @Test func tappingAStatusChipMatchesTypingItsToken() {
        let viaChip = TrafficFilterChips.togglingStatusClass("4xx", in: "")
        #expect(TrafficQueryParser.parse(viaChip) == TrafficQueryParser.parse("4xx"))
    }

    @Test func tappingAMethodChipMatchesTypingItsToken() {
        let viaChip = TrafficFilterChips.togglingMethod("POST", in: "")
        #expect(TrafficQueryParser.parse(viaChip) == TrafficQueryParser.parse("method:POST"))
    }

    @Test func tappingTheActiveMethodChipAgainClearsIt() {
        let selected = TrafficFilterChips.togglingMethod("GET", in: "")
        let cleared = TrafficFilterChips.togglingMethod("GET", in: selected)
        #expect(TrafficFilterChips.activeMethod(in: cleared) == nil)
        #expect(cleared.isEmpty)
    }

    @Test func tappingADifferentStatusChipReplacesTheActiveOne() {
        let firstSelected = TrafficFilterChips.togglingStatusClass("4xx", in: "")
        let replaced = TrafficFilterChips.togglingStatusClass("5xx", in: firstSelected)
        #expect(TrafficFilterChips.activeStatusClass(in: replaced) == "5xx")
        #expect(TrafficQueryParser.parse(replaced) == TrafficQueryParser.parse("5xx"))
    }

    @Test func toggleLeavesUnrelatedSearchTextIntact() {
        let withMethod = TrafficFilterChips.togglingMethod("GET", in: "host:\"api example\" 4xx")
        #expect(withMethod.contains("host:\"api example\""))
        #expect(withMethod.contains("4xx"))
        #expect(TrafficFilterChips.activeMethod(in: withMethod) == "GET")
    }

    @Test func activeStateReflectsHandTypedText() {
        #expect(TrafficFilterChips.activeMethod(in: "method:delete") == "DELETE")
        #expect(TrafficFilterChips.activeStatusClass(in: "3XX") == "3xx")
    }

    @Test func negatedTokensAreNeverReadAsActive() {
        #expect(TrafficFilterChips.activeMethod(in: "-method:GET") == nil)
        #expect(TrafficFilterChips.activeStatusClass(in: "-4xx") == nil)
    }

    /// End-to-end down to the compiled predicate, not just the parsed
    /// `TrafficQuery` — the chip's whole point is that the list actually
    /// filters, so this proves the compiler agrees too.
    @Test func compiledPredicateAgreesWithTheHandTypedToken() {
        let viaChip = TrafficFilterChips.togglingStatusClass("4xx", in: "")
        let matchViaChip = TrafficQueryCompiler.compile(TrafficQueryParser.parse(viaChip))
        let matchTyped = TrafficQueryCompiler.compile(TrafficQueryParser.parse("4xx"))

        let notFound = NetworkRequest(id: "a", url: "https://api.example.com/a", method: .get, status: 404, startTime: 0)
        let ok = NetworkRequest(id: "b", url: "https://api.example.com/b", method: .get, status: 200, startTime: 0)

        #expect(matchViaChip(notFound) == matchTyped(notFound))
        #expect(matchViaChip(ok) == matchTyped(ok))
        #expect(matchViaChip(notFound))
        #expect(!matchViaChip(ok))
    }
}
