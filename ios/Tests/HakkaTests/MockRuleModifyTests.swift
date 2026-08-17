import Testing
@testable import HakkaCommon

// MARK: - MockRuleTransform Tests
//
// Mirrors `packages/hakka-core/src/engine/MockEngine.ts`'s `applyHeaderEdits` /
// `applyQueryEdits` / `applyBodyReplacements` test surface exactly — same
// case-insensitive header removal, exact-key header set, plain-string body
// find/replace-in-order, empty-`find`-skipped semantics.
@Suite("MockRuleTransform")
struct MockRuleModifyTests {

    // MARK: - applyHeaderEdits

    @Test func headerEditsReturnsOriginalWhenNoEditsGiven() {
        let headers = ["A": "1"]
        #expect(MockRuleTransform.applyHeaderEdits(headers: headers, set: nil, remove: nil) == headers)
    }

    @Test func headerEditsSetOverwritesExistingKey() {
        let result = MockRuleTransform.applyHeaderEdits(headers: ["A": "1"], set: ["A": "2"], remove: nil)
        #expect(result["A"] == "2")
    }

    @Test func headerEditsSetAddsNewKey() {
        let result = MockRuleTransform.applyHeaderEdits(headers: [:], set: ["A": "1"], remove: nil)
        #expect(result["A"] == "1")
    }

    @Test func headerEditsRemoveIsCaseInsensitive() {
        let result = MockRuleTransform.applyHeaderEdits(headers: ["Content-Type": "text/plain"], set: nil, remove: ["content-type"])
        #expect(result["Content-Type"] == nil)
        #expect(result.isEmpty)
    }

    @Test func headerEditsRemoveThenSetSameKeyKeepsSetValue() {
        let result = MockRuleTransform.applyHeaderEdits(
            headers: ["X-A": "old"],
            set: ["X-A": "new"],
            remove: ["X-A"]
        )
        #expect(result["X-A"] == "new")
    }

    @Test func headerEditsRemoveNonexistentKeyIsNoOp() {
        let result = MockRuleTransform.applyHeaderEdits(headers: ["A": "1"], set: nil, remove: ["Nope"])
        #expect(result == ["A": "1"])
    }

    // MARK: - applyQueryEdits

    @Test func queryEditsReturnsOriginalWhenNoEditsGiven() {
        let url = "https://example.com/api?a=1"
        #expect(MockRuleTransform.applyQueryEdits(url: url, set: nil, remove: nil) == url)
    }

    @Test func queryEditsSetAddsNewParam() {
        let result = MockRuleTransform.applyQueryEdits(url: "https://example.com/api", set: ["a": "1"], remove: nil)
        #expect(result == "https://example.com/api?a=1")
    }

    @Test func queryEditsSetOverwritesExistingParam() {
        let result = MockRuleTransform.applyQueryEdits(url: "https://example.com/api?a=1", set: ["a": "2"], remove: nil)
        #expect(result.contains("a=2"))
        #expect(!result.contains("a=1"))
    }

    @Test func queryEditsRemoveDropsParam() {
        let result = MockRuleTransform.applyQueryEdits(url: "https://example.com/api?a=1&b=2", set: nil, remove: ["a"])
        #expect(!result.contains("a=1"))
        #expect(result.contains("b=2"))
    }

    @Test func queryEditsRemoveAllParamsDropsQuestionMark() {
        let result = MockRuleTransform.applyQueryEdits(url: "https://example.com/api?a=1", set: nil, remove: ["a"])
        #expect(!result.contains("?"))
        #expect(result == "https://example.com/api")
    }

    @Test func queryEditsPreservesUnrelatedParams() {
        let result = MockRuleTransform.applyQueryEdits(
            url: "https://example.com/api?keep=1&drop=2",
            set: ["extra": "3"],
            remove: ["drop"]
        )
        #expect(result.contains("keep=1"))
        #expect(result.contains("extra=3"))
        #expect(!result.contains("drop="))
    }

    @Test func queryEditsOnUnparsableUrlReturnsUnchanged() {
        // A URL string URLComponents genuinely cannot parse (unterminated
        // IPv6-literal host) — falls back to returning it unchanged.
        let bogus = "http://[invalid"
        #expect(MockRuleTransform.applyQueryEdits(url: bogus, set: ["a": "1"], remove: nil) == bogus)
    }

    // MARK: - applyBodyReplacements

    @Test func bodyReplacementsReturnsOriginalWhenNoneGiven() {
        #expect(MockRuleTransform.applyBodyReplacements(body: "hello", replacements: nil) == "hello")
        #expect(MockRuleTransform.applyBodyReplacements(body: "hello", replacements: []) == "hello")
    }

    @Test func bodyReplacementsReplacesAllOccurrences() {
        let result = MockRuleTransform.applyBodyReplacements(
            body: "foo bar foo",
            replacements: [MockRuleModify.BodyReplacement(find: "foo", replace: "baz")]
        )
        #expect(result == "baz bar baz")
    }

    @Test func bodyReplacementsAppliedInOrder() {
        let result = MockRuleTransform.applyBodyReplacements(
            body: "hello world",
            replacements: [
                MockRuleModify.BodyReplacement(find: "hello", replace: "hi"),
                MockRuleModify.BodyReplacement(find: "hi", replace: "hey"),
            ]
        )
        #expect(result == "hey world")
    }

    @Test func bodyReplacementsSkipsEmptyFind() {
        let result = MockRuleTransform.applyBodyReplacements(
            body: "hello",
            replacements: [MockRuleModify.BodyReplacement(find: "", replace: "x")]
        )
        #expect(result == "hello")
    }

    @Test func bodyReplacementsNoMatchLeavesBodyUnchanged() {
        let result = MockRuleTransform.applyBodyReplacements(
            body: "hello",
            replacements: [MockRuleModify.BodyReplacement(find: "nope", replace: "x")]
        )
        #expect(result == "hello")
    }
}
